import type { PluginServerContext } from "@getpaseo/plugin/server";

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
  startScheduler,
  stopJobHandler,
  stopScheduler,
  updateJobHandler,
} from "./server/jobs";
import {
  acknowledgeJob,
  clearJobLog,
  createJob,
  deleteJob,
  listJobs,
  readJobHealth,
  readJobLog,
  runJob,
  setJobEnabled,
  stopJob,
  updateJob,
} from "./shared/jobs";

export default function contribute(server: PluginServerContext) {
  server.handle(listJobs, listJobsHandler);
  server.handle(createJob, createJobHandler);
  server.handle(updateJob, updateJobHandler);
  server.handle(deleteJob, deleteJobHandler);
  server.handle(runJob, runJobHandler);
  server.handle(setJobEnabled, setJobEnabledHandler);
  server.handle(readJobLog, readJobLogHandler);
  server.handle(readJobHealth, readJobHealthHandler);
  server.handle(acknowledgeJob, acknowledgeJobHandler);
  server.handle(clearJobLog, clearJobLogHandler);
  server.handle(stopJob, stopJobHandler);

  // The daemon is the scheduler: its plugin subprocess holds one cron timer
  // per armed job, so arming happens on load and the cleanup stops the timers.
  void startScheduler().catch((error: unknown) => {
    console.error("[paseo-cron] could not arm the schedules:", error);
  });

  return () => {
    stopScheduler();
  };
}
