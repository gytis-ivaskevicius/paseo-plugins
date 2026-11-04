/**
 * The daemon half, end to end: the store on disk, the scheduler arming real
 * timers, and commands spawned through the user's shell. No launchctl, no
 * plists — the point of this fork is that a job is a JSON entry plus a timer
 * inside the daemon.
 *
 * `PASEO_HOME` is a temporary directory per test, so nothing touches the real
 * plugin-data. Timers are stopped after each test; a croner instance left
 * armed would keep vitest alive.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acknowledgeJobHandler,
  clearJobLogHandler,
  createJobHandler,
  deleteJobHandler,
  listJobsHandler,
  readJobHealthHandler,
  readJobLogHandler,
  runJobHandler,
  setJobEnabledHandler,
  stopJobHandler,
  stopScheduler,
  updateJobHandler,
} from "./jobs";
import { expandHome, shellInvocation } from "./scheduler";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "paseo-cron-test-"));
  process.env.PASEO_HOME = home;
});

afterEach(() => {
  stopScheduler();
  rmSync(home, { recursive: true, force: true });
  delete process.env.PASEO_HOME;
});

/**
 * "Run now" answers as soon as the process is spawned, so tests that assert on
 * a finished run wait for it here rather than for the RPC.
 */
async function settle(id: string, runs = 1): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const job = (await listJobsHandler()).jobs.find((entry) => entry.id === id);
    if (job !== undefined && !job.running && job.recentRuns.length >= runs) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the run of ${id} did not finish`);
}

const cronSpec = (name: string, command: string, expression = "0 3 * * *") => ({
  name,
  command,
  cwd: null,
  schedule: { type: "cron" as const, expression },
  timezone: null,
});

describe("jobs", () => {
  it("creates a job, arms it, and lists it with a next run", async () => {
    const job = await createJobHandler(cronSpec("Nightly backup", "true"));
    expect(job.id).toBe("nightly-backup");
    expect(job.enabled).toBe(true);
    expect(job.problem).toBeNull();
    expect(job.nextRun).not.toBeNull();

    const listed = await listJobsHandler();
    expect(listed.jobs.map((entry) => entry.name)).toEqual(["Nightly backup"]);
    expect(listed.timezone).not.toBe("");
    expect(listed.dataDir).toContain("paseo-cron");
  });

  it("gives a duplicate name its own id", async () => {
    const first = await createJobHandler(cronSpec("Backup", "true"));
    const second = await createJobHandler(cronSpec("Backup", "true"));
    expect(first.id).toBe("backup");
    expect(second.id).toBe("backup-2");
  });

  it("refuses an expression the scheduler cannot arm", async () => {
    await expect(createJobHandler(cronSpec("Bad", "true", "0 9 * *"))).rejects.toThrow(/five fields/);
  });

  it("starts a run immediately and reports it running", async () => {
    const job = await createJobHandler(cronSpec("Slow", "sleep 0.3"));
    const started = await runJobHandler({ id: job.id });
    expect(started.running).toBe(true);
    await settle(job.id);
  });

  it("runs a command now and records the run", async () => {
    const job = await createJobHandler(cronSpec("Hello", "printf 'hello from the job\\n'"));
    await runJobHandler({ id: job.id });
    await settle(job.id);

    const [after] = (await listJobsHandler()).jobs;
    expect(after?.recentRuns[0]?.exitCode).toBe(0);
    expect(after?.recentRuns[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(after?.lastExitCode).toBe(0);

    const log = await readJobLogHandler({ id: job.id });
    expect(log.text).toContain("hello from the job");
    expect(log.text).toContain("start");
    expect(log.text).toContain("exit 0");
  });

  it("records a failure, reports it, and forgets it once acknowledged", async () => {
    const job = await createJobHandler(cronSpec("Fails", "exit 7"));
    await runJobHandler({ id: job.id });
    await settle(job.id);

    expect((await readJobHealthHandler()).failing).toEqual([{ id: job.id, name: "Fails" }]);
    await acknowledgeJobHandler({ id: job.id });
    expect((await readJobHealthHandler()).failing).toEqual([]);

    // A later success drops the acknowledgement instead of hiding a failure.
    await updateJobHandler({ id: job.id, spec: cronSpec("Fails", "true") });
    await runJobHandler({ id: job.id });
    await settle(job.id, 2);
    expect((await readJobHealthHandler()).failing).toEqual([]);

    await updateJobHandler({ id: job.id, spec: cronSpec("Fails", "exit 2") });
    await runJobHandler({ id: job.id });
    await settle(job.id, 3);
    expect((await readJobHealthHandler()).failing).toEqual([{ id: job.id, name: "Fails" }]);
  });

  it("stops scheduling while disabled and resumes on enable", async () => {
    const job = await createJobHandler(cronSpec("Toggle", "true"));
    const off = await setJobEnabledHandler({ id: job.id, enabled: false });
    expect(off.enabled).toBe(false);
    expect(off.nextRun).toBeNull();

    const on = await setJobEnabledHandler({ id: job.id, enabled: true });
    expect(on.enabled).toBe(true);
    expect(on.nextRun).not.toBeNull();
  });

  it("reads the expression in the job's own time zone", async () => {
    const job = await createJobHandler({
      ...cronSpec("Zoned", "true", "0 2 * * *"),
      timezone: "America/New_York",
    });
    expect(job.timezone).toBe("America/New_York");
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(job.nextRun ?? ""));
    expect(local).toBe("02:00");
  });

  it("refuses a time zone the host does not know", async () => {
    await expect(
      createJobHandler({ ...cronSpec("Bad zone", "true"), timezone: "Mars/Olympus" }),
    ).rejects.toThrow(/not a time zone/);
  });

  it("takes an interval schedule", async () => {
    const job = await createJobHandler({
      name: "Poll",
      command: "true",
      cwd: null,
      schedule: { type: "interval", seconds: 90 },
      timezone: null,
    });
    expect(job.schedule).toEqual({ type: "interval", seconds: 90, description: "Every 90 seconds" });
    // The first run is one interval out, not immediately on enable.
    expect(job.nextRun).not.toBeNull();
    expect(Date.parse(job.nextRun ?? "") - Date.now()).toBeGreaterThan(85_000);
  });

  it("stops a running job and records the kill", async () => {
    const job = await createJobHandler(cronSpec("Long", "sleep 30"));
    await runJobHandler({ id: job.id });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const stopped = await stopJobHandler({ id: job.id });
    expect(stopped.id).toBe(job.id);

    await settle(job.id);
    const [after] = (await listJobsHandler()).jobs;
    expect(after?.running).toBe(false);
    expect(after?.recentRuns[0]?.exitCode).not.toBe(0);
    expect((await readJobLogHandler({ id: job.id })).text).toContain("killed by SIGTERM");
  });

  it("empties the log without touching the run history", async () => {
    const job = await createJobHandler(cronSpec("Noisy", "printf 'noise\\n'"));
    await runJobHandler({ id: job.id });
    await settle(job.id);
    expect((await readJobLogHandler({ id: job.id })).text).toContain("noise");

    await clearJobLogHandler({ id: job.id });
    expect((await readJobLogHandler({ id: job.id })).text).toBe("");
    const [after] = (await listJobsHandler()).jobs;
    expect(after?.recentRuns).toHaveLength(1);
    expect(after?.lastExitCode).toBe(0);
  });

  it("deletes the job and its files", async () => {
    const job = await createJobHandler(cronSpec("Temporary", "true"));
    await runJobHandler({ id: job.id });
    await settle(job.id);
    await deleteJobHandler({ id: job.id });
    expect((await listJobsHandler()).jobs).toEqual([]);
    await expect(readJobLogHandler({ id: job.id })).rejects.toThrow(/No job/);
  });
});

describe("paths and shells", () => {
  it("expands only a leading tilde", () => {
    expect(expandHome(null)).toBeUndefined();
    expect(expandHome("~")).toBe(process.env.HOME);
    expect(expandHome("~/projects")).toBe(join(process.env.HOME ?? "", "projects"));
    expect(expandHome("/tmp/~/x")).toBe("/tmp/~/x");
  });

  it("runs the command through the login shell on POSIX", () => {
    const { file, args } = shellInvocation("echo hi");
    if (process.platform === "win32") {
      expect(args.at(-1)).toBe("echo hi");
      return;
    }
    expect(file).toBe(process.env.SHELL ?? "/bin/sh");
    expect(args).toEqual(["-lc", "echo hi"]);
  });
});
