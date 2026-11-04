/**
 * The daemon half's RPC handlers: the store, the scheduler, and the run files,
 * composed into the `Job` shape the screen renders.
 *
 * Nothing here talks to an init system. `createJobHandler` writes a spec and
 * asks the scheduler to arm it, and everything the screen shows afterwards is
 * read back from those two places.
 */
import { Cron } from "croner";

import { describeCron, describeInterval, parseCron } from "../shared/cron";
import type { Job, JobSpec, RunRecord, ScheduleSpec } from "../shared/jobs";
import { arm, daemonTimezone, disarm, isRunning, nextRunAt, pidOf, problemFor, runNow, stopAll } from "./scheduler";
import {
  LOG_TAIL_BYTES,
  ensureDirs,
  logPath,
  mutate,
  readAcks,
  readJobs,
  readRuns,
  readTail,
  removeJobFiles,
  storeDir,
  writeAcks,
  type StoredJob,
} from "./store";

function isMissing(error: unknown): boolean {
  return (error as { code?: string }).code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Refuses an expression the scheduler cannot arm, before it reaches the store.
 * Accepts exactly what the form accepts plus whatever the library adds, so a
 * cron expression is checked by the parser that will run it.
 */
function assertSchedulable(schedule: ScheduleSpec): void {
  if (schedule.type === "interval") {
    if (!Number.isInteger(schedule.seconds) || schedule.seconds < 1) {
      throw new Error("The interval must be a whole number of seconds");
    }
    return;
  }
  const parsed = parseCron(schedule.expression);
  if (!parsed.ok) throw new Error(parsed.error);
  let probe: Cron | null = null;
  try {
    probe = new Cron(schedule.expression, { paused: true });
  } catch (error) {
    throw new Error(`Cron rejected that expression: ${errorMessage(error)}`);
  } finally {
    probe?.stop();
  }
}

function scheduleOf(schedule: ScheduleSpec): Job["schedule"] {
  if (schedule.type === "interval") {
    return { type: "interval", seconds: schedule.seconds, description: describeInterval(schedule.seconds) };
  }
  const parsed = parseCron(schedule.expression);
  const description = parsed.ok ? describeCron(parsed.fields) : "Invalid expression";
  return { type: "cron", expression: schedule.expression, description };
}

function normaliseSpec(input: JobSpec): JobSpec {
  return {
    name: input.name.trim(),
    command: input.command.trim(),
    cwd: input.cwd === null || input.cwd.trim() === "" ? null : input.cwd.trim(),
    schedule: input.schedule,
  };
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base === "" ? "job" : base;
}

function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function findJob(id: string): Promise<StoredJob> {
  const job = (await readJobs()).find((entry) => entry.id === id);
  if (job === undefined) throw new Error(`No job with id "${id}"`);
  return job;
}

async function buildJob(job: StoredJob): Promise<Job> {
  let recentRuns: RunRecord[] = [];
  let problem: string | null = problemFor(job.id);
  try {
    recentRuns = await readRuns(job.id);
  } catch (error) {
    problem = `Could not read the run history: ${errorMessage(error)}`;
  }
  return {
    id: job.id,
    name: job.name,
    command: job.command,
    cwd: job.cwd,
    schedule: scheduleOf(job.schedule),
    enabled: job.enabled,
    running: isRunning(job.id),
    pid: pidOf(job.id),
    lastExitCode: recentRuns[0]?.exitCode ?? null,
    recentRuns,
    nextRun: nextRunAt(job.id),
    logPath: logPath(job.id),
    problem,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle

/** Arms every enabled job. Called once when the plugin's server entry loads. */
export async function startScheduler(): Promise<void> {
  await ensureDirs();
  const jobs = await readJobs();
  for (const job of jobs) arm(job);
}

/** Stops the timers on plugin teardown. Running commands are left to finish. */
export function stopScheduler(): void {
  stopAll();
}

// ---------------------------------------------------------------------------
// Handlers

export async function listJobsHandler(): Promise<{ jobs: Job[]; dataDir: string; timezone: string }> {
  const stored = await readJobs();
  const jobs = await Promise.all(stored.map(buildJob));
  // A store that could not be read is reported as a job-less list with the
  // error in the RPC rejection; the screen's own error banner shows it.
  jobs.sort((left, right) => left.name.localeCompare(right.name));
  return { jobs, dataDir: storeDir(), timezone: daemonTimezone() };
}

export async function createJobHandler(input: JobSpec): Promise<Job> {
  const spec = normaliseSpec(input);
  assertSchedulable(spec.schedule);
  const created = await mutate(async function add(jobs) {
    const now = new Date().toISOString();
    const job: StoredJob = {
      id: uniqueSlug(spec.name, new Set(jobs.map((entry) => entry.id))),
      name: spec.name,
      command: spec.command,
      cwd: spec.cwd,
      schedule: spec.schedule,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    return { next: [...jobs, job], result: job };
  });
  arm(created);
  return buildJob(created);
}

export async function updateJobHandler(input: { id: string; spec: JobSpec }): Promise<Job> {
  const spec = normaliseSpec(input.spec);
  assertSchedulable(spec.schedule);
  const updated = await mutate(async function edit(jobs) {
    const existing = jobs.find((entry) => entry.id === input.id);
    if (existing === undefined) throw new Error(`No job with id "${input.id}"`);
    const job: StoredJob = {
      ...existing,
      name: spec.name,
      command: spec.command,
      cwd: spec.cwd,
      schedule: spec.schedule,
      updatedAt: new Date().toISOString(),
    };
    return { next: jobs.map((entry) => (entry.id === input.id ? job : entry)), result: job };
  });
  disarm(updated.id);
  arm(updated);
  return buildJob(updated);
}

export async function deleteJobHandler(input: { id: string }): Promise<Record<string, never>> {
  disarm(input.id);
  await mutate(async function remove(jobs) {
    if (!jobs.some((entry) => entry.id === input.id)) throw new Error(`No job with id "${input.id}"`);
    return { next: jobs.filter((entry) => entry.id !== input.id), result: undefined };
  });
  await removeJobFiles(input.id);
  const acks = await readAcks();
  if (input.id in acks) {
    delete acks[input.id];
    await writeAcks(acks);
  }
  return {};
}

export async function runJobHandler(input: { id: string }): Promise<Record<string, never>> {
  await runNow(await findJob(input.id));
  return {};
}

export async function setJobEnabledHandler(input: { id: string; enabled: boolean }): Promise<Job> {
  const job = await mutate(async function toggle(jobs) {
    const existing = jobs.find((entry) => entry.id === input.id);
    if (existing === undefined) throw new Error(`No job with id "${input.id}"`);
    const next: StoredJob = { ...existing, enabled: input.enabled, updatedAt: new Date().toISOString() };
    return { next: jobs.map((entry) => (entry.id === input.id ? next : entry)), result: next };
  });
  disarm(job.id);
  arm(job);
  return buildJob(job);
}

export async function readJobLogHandler(input: { id: string }): Promise<{ text: string; truncated: boolean; path: string }> {
  await findJob(input.id);
  const path = logPath(input.id);
  try {
    const tail = await readTail(path, LOG_TAIL_BYTES);
    return { ...tail, path };
  } catch (error) {
    if (isMissing(error)) return { text: "", truncated: false, path };
    throw error;
  }
}

/**
 * Which jobs are failing and unacknowledged. Reads only the history files, so
 * the sidebar's minute-by-minute poll stays cheap and does not touch the
 * scheduler.
 */
export async function readJobHealthHandler(): Promise<{ failing: { id: string; name: string }[] }> {
  const [jobs, acks] = await Promise.all([readJobs(), readAcks()]);
  const checked = await Promise.all(
    jobs.map(async function check(job): Promise<{ id: string; name: string } | null> {
      const last = (await readRuns(job.id))[0];
      if (last === undefined || last.exitCode === 0) return null;
      if (acks[job.id] === last.startedAt) return null;
      return { id: job.id, name: job.name };
    }),
  );
  const failing: { id: string; name: string }[] = [];
  for (const entry of checked) {
    if (entry !== null) failing.push(entry);
  }
  return { failing };
}

/**
 * Remembers that the user has seen this job's latest run. A job whose latest
 * run succeeded loses its entry instead of gaining one, so acknowledging is
 * never what makes a later failure silent. Entries for deleted jobs are
 * dropped on the way past.
 */
export async function acknowledgeJobHandler(input: { id: string }): Promise<Record<string, never>> {
  const [last, acks, jobs] = await Promise.all([readRuns(input.id).then((runs) => runs[0]), readAcks(), readJobs()]);
  const known = new Set(jobs.map((job) => job.id));
  const next: Record<string, string> = {};
  for (const [id, startedAt] of Object.entries(acks)) {
    if (known.has(id)) next[id] = startedAt;
  }
  if (last === undefined || last.exitCode === 0) delete next[input.id];
  else next[input.id] = last.startedAt;
  await writeAcks(next);
  return {};
}
