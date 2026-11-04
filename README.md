# paseo-cron

A Paseo plugin that schedules shell commands **without an operating-system
scheduler**. No launchd agents, no systemd timers, no crontab: the Paseo daemon
holds the timers inside the plugin's own server process and spawns the commands
itself, so the same plugin works on macOS, Linux and Windows and keeps the job
list, logs and history in one portable place.

It adds a **Scheduled jobs** screen: create a job with a name, a command, a
working directory and either a cron expression or a fixed interval. The screen
shows the next run, the last twenty runs with exit codes, and the log.

A fork of [gpambrozio/paseo-plugins' `launchd-jobs`](https://github.com/gpambrozio/paseo-plugins/tree/main/launchd-jobs),
which is a front for launchd on macOS. The screen, the cron parser, the run
history and the failure badge are its work.

## Install

```
paseo plugin install /absolute/path/to/paseo-cron
```

Then enable plugins on the daemon if you have not already (Settings → Plugins).
Requires Paseo 0.11 or newer on the daemon and on whatever you view the jobs on.

## What a job is

A job is one entry in `$PASEO_HOME/plugin-data/paseo-cron/jobs.json` and one
timer in the daemon's plugin subprocess:

```json
{
  "id": "nightly-backup",
  "name": "Nightly backup",
  "command": "rsync -a ~/Documents /backup",
  "cwd": null,
  "schedule": { "type": "cron", "expression": "30 2 * * *" },
  "enabled": true
}
```

The command runs through your login shell (`$SHELL -lc`, `cmd /c` on Windows),
so it reads the same startup files a terminal would and finds the same `PATH` —
the usual reason a scheduled command works by hand and fails on a timer. `cwd`
may start with `~/`; without one the command starts in your home directory.

### Schedules

**Cron expression**, five fields: minute, hour, day of month, month, weekday.
Lists (`1,15`), ranges (`9-17`), steps (`*/15`, `9-17/2`) and three-letter names
(`mon`, `jan`) work. The form shows the schedule in words as you type — "At
09:00 on Mon–Fri". A restricted day of month and weekday are alternatives, as
cron defines them (`0 20 1 * mon` fires on the 1st **or** on Mondays).

**Fixed interval**: every N seconds, minutes or hours, counted from when the job
was enabled.

Schedules are read in the daemon's own time zone, which the detail pane shows.

## When it fires, and when it does not

- **Paseo daemon running**: the job runs. Paseo's desktop app or a daemon you
  keep running is the scheduler.
- **Machine asleep at the scheduled time**: one run when it wakes. Croner fires
  a late trigger once and skips the occurrences it missed.
- **Daemon stopped**: the run is missed. Nothing replays it. This is the price
  of not installing anything into the OS — if you need a command to run while
  Paseo is down, it does not belong here.
- **Plugin reloaded**: timers are re-armed from `jobs.json`. A run already in
  progress keeps running, but its history line is lost if the daemon kills the
  plugin process before it exits.
- **Job disabled**: no timer is armed.

A trigger that arrives while the previous run is still going is skipped, with a
line saying so in the log. A job that takes longer than its interval is a job
whose schedule is wrong; stacking copies would hide that.

## Runs and logs

Each run appends `=== <time> start`, the command's combined output, and
`=== <time> exit <code>` to `logs/<id>.log`. Timings go to `runs/<id>.jsonl`.
The screen shows the last twenty runs and the last 64 KB of the log. A log is
rotated once it passes 1 MB, and the history keeps its last two hundred runs.
Everything lives under `$PASEO_HOME/plugin-data/paseo-cron/` and survives a
plugin reinstall.

**Follow** re-reads the log every second while the pane is looking, so a run's
output appears as it is written. It needs no workspace and leaves nothing
running: switching jobs or leaving the screen ends it.

**Clear log** empties the job's log file, and the rotated one with it. The run
history stays: what each run exited with and how long it took is not log data.

**Run now** starts the job immediately without touching its schedule.

## When a job fails

A job whose most recent run exited non-zero shows a red count beside **Scheduled
jobs** and a crossed-out calendar icon. Tapping the count lists the failing
jobs. Opening a job acknowledges the failure; it comes back if the job fails
again. The count is checked about once a minute.

## Removing

Deleting a job stops its timer and deletes its log and history. Removing the
plugin stops every timer; the store and logs stay in `plugin-data/` so a
reinstall finds them.

## Limitations

- Jobs run only while the daemon runs. There is no catch-up for time the daemon
  was stopped.
- One daemon, one set of jobs. Jobs are per host, like everything else in Paseo.
- No seconds-level cron fields; use a fixed interval for sub-minute precision.
- A running job cannot be killed from the screen yet.
