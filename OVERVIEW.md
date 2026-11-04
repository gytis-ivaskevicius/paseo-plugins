# Scheduled jobs

A scheduler for shell commands that lives inside Paseo. Create a job with a
name, a command and a schedule, and the daemon runs it, keeps its output and
records every run. There is no launchd agent, no systemd timer and no crontab on
the machine.

It is a fork of the launchd-jobs plugin, keeping its screen and its cron parser
and replacing the operating-system backend with timers held by the daemon.

## What it does

Each job is a shell command plus a five-field cron expression or a fixed
interval. The screen lists the jobs with their next run and last result, and
shows one job's schedule, command, working directory, recent runs and log tail.
A red badge beside the sidebar row counts jobs whose last run failed.

The command runs through your login shell, so it sees the same `PATH` and the
same startup files as a terminal. Working directories may start with `~/`.

## How it works

The plugin's daemon process keeps one timer per enabled job using the croner
library, and spawns the command with Node's process API on each trigger. Jobs,
logs and run history are files under the plugin's data directory, so they
survive a plugin reinstall. Cron expressions are read in the daemon's time zone,
which the job screen shows.

## Requirements and limits

Paseo 0.11 or newer, on the host running the daemon. The daemon must be running
for a job to fire: a run missed while it was stopped is not replayed, and a
machine that was asleep gets one run when it wakes. A trigger that arrives while
the previous run is still going is skipped and noted in the log.

## Data

Jobs live in `jobs.json` under Paseo's plugin data directory, beside a log and a
JSON-lines history per job. Nothing is written outside that directory and
nothing is sent anywhere.
