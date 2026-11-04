import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * The zod contracts both halves agree on. Every crossing between the surface
 * and the daemon is one of these; the server validates its side too, so a
 * client that lies is refused rather than written into the job store.
 */

/** What a user asks for: a cron expression, or a fixed number of seconds. */
export const ScheduleSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cron"), expression: z.string().trim().min(1) }),
  z.object({ type: z.literal("interval"), seconds: z.number().int().positive() }),
]);

export type ScheduleSpec = z.infer<typeof ScheduleSpecSchema>;

export const JobSpecSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Run through the user's login shell, so it can be anything a shell takes. */
  command: z.string().trim().min(1),
  /** Absolute path, or null for the daemon user's home directory. */
  cwd: z.string().trim().nullable(),
  schedule: ScheduleSpecSchema,
});

export type JobSpec = z.infer<typeof JobSpecSchema>;

/** What the store says about when a job fires. */
export const ScheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cron"), expression: z.string(), description: z.string() }),
  z.object({ type: z.literal("interval"), seconds: z.number().int(), description: z.string() }),
]);

export type Schedule = z.infer<typeof ScheduleSchema>;

/** One line of a job's history file. */
export const RunRecordSchema = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  exitCode: z.number().int(),
  durationMs: z.number().int().min(0),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

export const JobSchema = z.object({
  /** The slug, derived from the name when the job was created. */
  id: z.string(),
  name: z.string(),
  command: z.string(),
  cwd: z.string().nullable(),
  schedule: ScheduleSchema,
  /**
   * Whether the daemon has this job armed. A job with an expression the
   * scheduler refuses stays in the store, disabled, with `problem` set.
   */
  enabled: z.boolean(),
  running: z.boolean(),
  pid: z.number().int().nullable(),
  lastExitCode: z.number().int().nullable(),
  /** Most recent first. */
  recentRuns: z.array(RunRecordSchema),
  /** ISO time of the next scheduled run; null while disabled. */
  nextRun: z.string().nullable(),
  logPath: z.string(),
  /** Why the job is not armed: an expression or a directory the daemon refused. */
  problem: z.string().nullable(),
});

export type Job = z.infer<typeof JobSchema>;

export const listJobs = defineRpc({
  name: "jobs.list",
  input: z.object({}),
  output: z.object({
    jobs: z.array(JobSchema),
    /** Where the job store, logs and history live. */
    dataDir: z.string(),
    /** The daemon's IANA time zone; schedules are read in it. */
    timezone: z.string(),
  }),
});

export const createJob = defineRpc({
  name: "jobs.create",
  input: JobSpecSchema,
  output: JobSchema,
});

export const updateJob = defineRpc({
  name: "jobs.update",
  input: z.object({ id: z.string(), spec: JobSpecSchema }),
  output: JobSchema,
});

export const deleteJob = defineRpc({
  name: "jobs.delete",
  input: z.object({ id: z.string() }),
  output: z.object({}),
});

export const runJob = defineRpc({
  name: "jobs.run",
  input: z.object({ id: z.string() }),
  /** The job as it is after the spawn, so the surface can show it running. */
  output: JobSchema,
});

export const setJobEnabled = defineRpc({
  name: "jobs.set-enabled",
  input: z.object({ id: z.string(), enabled: z.boolean() }),
  output: JobSchema,
});

export const readJobLog = defineRpc({
  name: "jobs.log",
  input: z.object({ id: z.string() }),
  output: z.object({
    text: z.string(),
    /** The file was longer than the tail that came back. */
    truncated: z.boolean(),
    path: z.string(),
  }),
});

export const clearJobLog = defineRpc({
  name: "jobs.clear-log",
  input: z.object({ id: z.string() }),
  output: z.object({}),
});

/**
 * The cheap health check behind the sidebar's failure count. `jobs.list` reads
 * every history file; this reads only the last line of each, because the
 * sidebar asks for it on a timer whether or not the surface is open.
 *
 * A job is failing when its most recent recorded run exited non-zero and that
 * run has not been acknowledged.
 */
export const readJobHealth = defineRpc({
  name: "jobs.health",
  input: z.object({}),
  output: z.object({
    failing: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
});

/**
 * Marks a job's latest failure as seen, which is what opening it in the surface
 * does. The alert comes back the next time the job fails, because what is
 * remembered is the run, not the job.
 */
export const acknowledgeJob = defineRpc({
  name: "jobs.acknowledge",
  input: z.object({ id: z.string() }),
  output: z.object({}),
});
