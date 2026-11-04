/**
 * The scheduler: one cron library instance per armed job, one child process
 * per run.
 *
 * This is the whole point of the fork. Nothing here asks an operating system
 * to run something later — Paseo's daemon owns the timers, inside the plugin's
 * own server subprocess, and spawns the command itself. That works the same on
 * macOS, Linux and Windows, and it means the plugin can report a live pid, a
 * precise duration, and an overlap skip without parsing anyone's prose.
 *
 * The trade, stated where it hurts: **a job runs only while the daemon runs.**
 * Croner fires a trigger once when the machine wakes from sleep, and skips the
 * occurrences it missed, which is what cron does after a reboot. Time spent
 * with the daemon stopped is not replayed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Cron } from "croner";

import { appendRun, ensureDirs, logPath, rotateLogIfLarge } from "./store";
import type { StoredJob } from "./store";

/** What a run needs from the job; a snapshot, so an edit cannot change it mid-run. */
interface JobSnapshot {
  id: string;
  command: string;
  cwd: string | null;
}

interface Running {
  pid: number;
  startedAt: Date;
}

/** A spawned run: the object exists now, `completion` settles when it is over. */
interface Run {
  completion: Promise<void>;
}

const armed = new Map<string, Cron>();
const running = new Map<string, Running>();
const problems = new Map<string, string>();
/**
 * Jobs whose `fire` has been entered but whose process is not spawned yet.
 * Set synchronously, before the first await, so a cron trigger and a "Run now"
 * arriving together cannot both decide the job is idle and spawn two copies.
 */
const inflight = new Set<string>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The command's shell: the daemon user's login shell on POSIX, so it reads the
 * same startup files a terminal would and finds the same PATH; `cmd` on
 * Windows. Job commands are therefore typed like a prompt line, not like an
 * argv array.
 */
export function shellInvocation(command: string): { file: string; args: string[] } {
  if (process.platform === "win32") {
    const file = process.env.ComSpec ?? "cmd.exe";
    return { file, args: ["/d", "/s", "/c", command] };
  }
  const shell = process.env.SHELL;
  return { file: shell === undefined || shell === "" ? "/bin/sh" : shell, args: ["-lc", command] };
}

/** `~/x` and `~` only; anything else is passed through untouched. */
export function expandHome(path: string | null): string | undefined {
  if (path === null || path === "") return undefined;
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

/** The IANA zone the daemon reads cron expressions in. */
export function daemonTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

// ---------------------------------------------------------------------------
// Arming

/**
 * Arms one job's schedule, replacing any previous one. A job that is disabled,
 * or whose expression the library refuses, ends up with no schedule and — in
 * the second case — a problem the screen shows.
 */
export function arm(job: StoredJob): void {
  disarm(job.id);
  problems.delete(job.id);
  if (!job.enabled) return;
  const snapshot: JobSnapshot = { id: job.id, command: job.command, cwd: job.cwd };
  // croner reads the expression in its own local zone unless told otherwise.
  const zone = job.timezone === null ? {} : { timezone: job.timezone };
  try {
    const cron =
      job.schedule.type === "cron"
        ? new Cron(job.schedule.expression, zone, () => void fire(snapshot))
        : // A one-second pattern with a minimum gap is how croner expresses
          // "every N seconds"; no expression can name an arbitrary interval.
          // `startAt` pushes the first run one interval out, so enabling a
          // six-hour job does not run it on the spot.
          new Cron(
            "* * * * * *",
            { ...zone, interval: job.schedule.seconds, startAt: new Date(Date.now() + job.schedule.seconds * 1000) },
            () => void fire(snapshot),
          );
    armed.set(job.id, cron);
  } catch (error) {
    problems.set(job.id, errorMessage(error));
  }
}

export function disarm(id: string): void {
  const cron = armed.get(id);
  if (cron === undefined) return;
  cron.stop();
  armed.delete(id);
}

/** Stops every timer. A run already in progress is left to finish. */
export function stopAll(): void {
  for (const cron of armed.values()) cron.stop();
  armed.clear();
}

/** ISO time of the next scheduled run, or null when the job is not armed. */
export function nextRunAt(id: string): string | null {
  const cron = armed.get(id);
  if (cron === undefined) return null;
  const next = cron.nextRun();
  return next === null ? null : next.toISOString();
}

export function isRunning(id: string): boolean {
  return inflight.has(id) || running.has(id);
}

export function pidOf(id: string): number | null {
  return running.get(id)?.pid ?? null;
}

/** Why a job could not be armed, or null when it is fine. */
export function problemFor(id: string): string | null {
  return problems.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// Running

/**
 * Runs a job now, outside its schedule, and returns as soon as the process is
 * spawned — the caller gets to show "Running" instead of a button that looks
 * stuck for the length of the command. Refuses while the same job is already
 * going, so a manual press cannot stack copies.
 */
export async function startRun(job: StoredJob): Promise<void> {
  if (isRunning(job.id)) throw new Error("That job is already running");
  inflight.add(job.id);
  let run: Run;
  try {
    run = await spawnRun({ id: job.id, command: job.command, cwd: job.cwd }, true);
  } catch (error) {
    inflight.delete(job.id);
    throw error;
  }
  void run.completion.catch(() => undefined).finally(() => inflight.delete(job.id));
}

/**
 * A scheduled trigger. Overlapping triggers are skipped with a line in the log
 * rather than queued — a job that takes longer than its interval is a job
 * whose schedule is wrong.
 */
function fire(job: JobSnapshot): void {
  // Claimed synchronously: two triggers in the same tick must not both pass
  // the idle check while the first is still opening its log.
  if (inflight.has(job.id)) {
    void appendSkip(job.id);
    return;
  }
  inflight.add(job.id);
  void spawnRun(job, false)
    .then((run) => run.completion)
    .catch((error: unknown) => {
      console.error(`[paseo-cron] could not start ${job.id}: ${errorMessage(error)}`);
    })
    .finally(() => inflight.delete(job.id));
}

/**
 * One run: rotate the log if it is fat, write a start marker, spawn the shell,
 * stream its output into the log, then record a history line. `completion`
 * settles when the run is over and its history line is on disk.
 *
 * The result is an object because an async function returning a bare promise
 * would have it flattened by `await` — and the point is to hand back a handle
 * to the run while it is still going.
 *
 * Throws only when the log cannot be opened, which is worth telling a user who
 * pressed Run now; a command that fails to spawn is a failed run instead.
 */
async function spawnRun(job: JobSnapshot, manual: boolean): Promise<Run> {
  const startedAt = new Date();
  await ensureDirs();
  await rotateLogIfLarge(job.id);
  const stream = createWriteStream(logPath(job.id), { flags: "a" });
  // A log that cannot be written must not take the daemon down with an
  // unhandled stream error; the run still happens and is still recorded.
  stream.on("error", (error: Error) => {
    console.error(`[paseo-cron] could not write the log for ${job.id}: ${error.message}`);
  });

  const write = (text: string): void => {
    stream.write(text);
  };
  write(`=== ${startedAt.toISOString()} start${manual ? " (run now)" : ""}\n`);

  let child: ChildProcess;
  try {
    const { file, args } = shellInvocation(job.command);
    child = spawn(file, args, {
      cwd: expandHome(job.cwd) ?? homedir(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    write(`=== ${new Date().toISOString()} could not start: ${errorMessage(error)}\n`);
    stream.end();
    return { completion: record(job.id, startedAt, 1) };
  }

  if (child.pid !== undefined) running.set(job.id, { pid: child.pid, startedAt });
  child.stdout?.on("data", (chunk: Buffer) => write(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => write(chunk.toString("utf8")));

  const completion = new Promise<void>((resolve) => {
    let settled = false;
    const finish = async function finish(exitCode: number, note: string | null): Promise<void> {
      if (settled) return;
      settled = true;
      if (note !== null) write(`=== ${new Date().toISOString()} ${note}\n`);
      write(`=== ${new Date().toISOString()} exit ${exitCode}\n`);
      running.delete(job.id);
      await new Promise<void>((flushed) => {
        stream.once("close", () => flushed());
        stream.end();
      });
      await record(job.id, startedAt, exitCode);
      resolve();
    };
    child.on("error", (error: Error) => void finish(1, `could not start: ${error.message}`));
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (code !== null) void finish(code, null);
      else void finish(1, `killed by ${signal ?? "a signal"}`);
    });
  });
  return { completion };
}

async function record(id: string, startedAt: Date, exitCode: number): Promise<void> {
  const finishedAt = new Date();
  try {
    await appendRun(id, {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      exitCode,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    });
  } catch (error) {
    console.error(`[paseo-cron] could not record the run of ${id}: ${errorMessage(error)}`);
  }
}

/** A trigger that arrived while the previous run was still going. */
async function appendSkip(id: string): Promise<void> {
  const path = logPath(id);
  try {
    await mkdir(dirname(path), { recursive: true });
    const when = new Date().toISOString();
    await appendFile(path, `=== ${when} skipped: the previous run is still going\n`, "utf8");
  } catch (error) {
    console.error(`[paseo-cron] could not note a skipped run of ${id}: ${errorMessage(error)}`);
  }
}
