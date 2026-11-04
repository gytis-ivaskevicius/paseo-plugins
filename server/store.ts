/**
 * The job store, its history, and the acknowledgements — everything that has
 * to outlive the daemon process.
 *
 * `jobs.json` is the source of truth: one array of job specs, written whole
 * through a temporary file so a crash mid-write leaves the old file intact.
 * `runs/<id>.jsonl` and `logs/<id>.log` are append-only, written by the
 * scheduler as it runs things. `acknowledged.json` remembers which failure the
 * user has already seen, which no file of run output can tell us.
 *
 * Every read-modify-write goes through `mutate`, because RPC handlers are
 * async and two saves interleaving would drop one of them.
 */
import { appendFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { RunRecord, ScheduleSpec } from "../shared/jobs";
import { dataPath, pluginDir } from "./data-dir";

export interface StoredJob {
  id: string;
  name: string;
  command: string;
  cwd: string | null;
  schedule: ScheduleSpec;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface JobsFile {
  version: 1;
  jobs: StoredJob[];
}

interface AckFile {
  acknowledged: Record<string, string>;
}

const EMPTY: JobsFile = { version: 1, jobs: [] };

function isMissing(error: unknown): boolean {
  return (error as { code?: string }).code === "ENOENT";
}

function jobsFile(): string {
  return dataPath("jobs.json");
}

function ackFile(): string {
  return dataPath("acknowledged.json");
}

export function logPath(id: string): string {
  return dataPath(`logs/${id}.log`);
}

export function runsPath(id: string): string {
  return dataPath(`runs/${id}.jsonl`);
}

/** Creates the directories the scheduler writes into. Idempotent. */
export async function ensureDirs(): Promise<void> {
  await mkdir(dataPath("logs"), { recursive: true });
  await mkdir(dataPath("runs"), { recursive: true });
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, path);
}

function isStoredJob(value: unknown): value is StoredJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  const schedule = job.schedule as Record<string, unknown> | undefined;
  return (
    typeof job.id === "string" &&
    typeof job.name === "string" &&
    typeof job.command === "string" &&
    (job.cwd === null || typeof job.cwd === "string") &&
    typeof job.enabled === "boolean" &&
    typeof job.createdAt === "string" &&
    typeof job.updatedAt === "string" &&
    typeof schedule === "object" &&
    schedule !== null &&
    (schedule.type === "cron"
      ? typeof schedule.expression === "string"
      : schedule.type === "interval"
        ? typeof schedule.seconds === "number"
        : false)
  );
}

export async function readJobs(): Promise<StoredJob[]> {
  let text: string;
  try {
    text = await readFile(jobsFile(), "utf8");
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A corrupt store is better reported than silently replaced: the screen
    // shows an empty list, and the file is still on disk for the user.
    throw new Error(`The job store at ${jobsFile()} is not valid JSON`);
  }
  const file = parsed as Partial<JobsFile>;
  if (!Array.isArray(file.jobs)) return [];
  // A hand-edited entry that no longer fits the shape is dropped rather than
  // blanking every job.
  return file.jobs.filter(isStoredJob);
}

export async function writeJobs(jobs: readonly StoredJob[]): Promise<void> {
  const file: JobsFile = { ...EMPTY, jobs: [...jobs] };
  await writeAtomic(jobsFile(), `${JSON.stringify(file, null, 2)}\n`);
}

/** Serialises read-modify-write cycles of `jobs.json` within this process. */
let queue: Promise<unknown> = Promise.resolve();

export function mutate<T>(change: (jobs: readonly StoredJob[]) => Promise<{ next: readonly StoredJob[]; result: T }>): Promise<T> {
  const run = queue.then(async function apply(): Promise<T> {
    const { next, result } = await change(await readJobs());
    await writeJobs(next);
    return result;
  });
  // A failed change must not poison the next one.
  queue = run.catch(() => undefined);
  return run;
}

export async function readAcks(): Promise<Record<string, string>> {
  try {
    const text = await readFile(ackFile(), "utf8");
    const parsed: unknown = JSON.parse(text);
    const acknowledged = (parsed as Partial<AckFile>).acknowledged;
    if (typeof acknowledged !== "object" || acknowledged === null) return {};
    const clean: Record<string, string> = {};
    for (const [id, startedAt] of Object.entries(acknowledged)) {
      if (typeof startedAt === "string") clean[id] = startedAt;
    }
    return clean;
  } catch (error) {
    if (isMissing(error)) return {};
    // An unreadable acknowledgement file only ever re-raises an alert.
    return {};
  }
}

export async function writeAcks(acknowledged: Record<string, string>): Promise<void> {
  await writeAtomic(ackFile(), `${JSON.stringify({ acknowledged }, null, 2)}\n`);
}

/** Deletes a job's log and history. Missing files are not an error. */
export async function removeJobFiles(id: string): Promise<void> {
  for (const path of [logPath(id), `${logPath(id)}.1`, runsPath(id)]) {
    try {
      await unlink(path);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

export function storeDir(): string {
  return pluginDir();
}

// ---------------------------------------------------------------------------
// Logs and run history

/** How much of a log the panel gets. Older output is still in the file. */
export const LOG_TAIL_BYTES = 64 * 1024;
const RUNS_TAIL_BYTES = 64 * 1024;
const RECENT_RUNS = 20;
const LOG_ROTATE_BYTES = 1024 * 1024;
const RUNS_COMPACT_BYTES = 256 * 1024;
const RUNS_KEPT = 200;

/**
 * The last `bytes` of a file, from the first whole line. A missing file is
 * an empty tail, not an error: a job that has never run has no log yet.
 */
export async function readTail(path: string, bytes: number): Promise<{ text: string; truncated: boolean }> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (isMissing(error)) return { text: "", truncated: false };
    throw error;
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    let text = buffer.toString("utf8");
    const truncated = start > 0;
    if (truncated) {
      const newline = text.indexOf("\n");
      text = newline === -1 ? "" : text.slice(newline + 1);
    }
    return { text, truncated };
  } finally {
    await handle.close();
  }
}

function parseRun(line: string): RunRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.startedAt !== "string" ||
      typeof record.finishedAt !== "string" ||
      typeof record.exitCode !== "number" ||
      typeof record.durationMs !== "number"
    ) {
      return null;
    }
    return {
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      exitCode: record.exitCode,
      durationMs: Math.max(0, Math.round(record.durationMs)),
    };
  } catch {
    return null;
  }
}

/** The most recent runs, newest first. */
export async function readRuns(id: string): Promise<RunRecord[]> {
  const { text } = await readTail(runsPath(id), RUNS_TAIL_BYTES);
  const records: RunRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const record = parseRun(line);
    if (record !== null) records.push(record);
  }
  return records.slice(-RECENT_RUNS).reverse();
}

/** The latest recorded run, or null when the job has never run. */
export async function readLastRun(id: string): Promise<RunRecord | null> {
  return (await readRuns(id))[0] ?? null;
}

/**
 * Appends one line of history, then compacts the file once it has grown past
 * a quarter of a megabyte. Compaction keeps the last two hundred runs, which
 * is more than the screen ever shows.
 */
export async function appendRun(id: string, record: RunRecord): Promise<void> {
  const path = runsPath(id);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
  const { size } = await stat(path);
  if (size <= RUNS_COMPACT_BYTES) return;
  const { text } = await readTail(path, Number.MAX_SAFE_INTEGER);
  const kept = text.split("\n").filter((line) => line.trim() !== "").slice(-RUNS_KEPT);
  await writeAtomic(path, `${kept.join("\n")}\n`);
}

/** Rotates the log once it passes a megabyte, before a run starts appending. */
export async function rotateLogIfLarge(id: string): Promise<void> {
  const path = logPath(id);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (size > LOG_ROTATE_BYTES) await rename(path, `${path}.1`);
}
