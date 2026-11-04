# Changelog

## 0.1.0

Fork of `@gpambrozio/paseo-launchd-jobs` 0.6.0, rebuilt around the daemon as the
scheduler:

- Jobs are timers in the plugin's daemon process (croner), not LaunchAgents.
  Works on macOS, Linux and Windows; nothing is installed into the OS.
- Commands run through the login shell with the daemon's environment, and `cwd`
  expands a leading `~/`.
- Live pid, precise duration, overlap skip with a log line, and "Run now" that
  returns the job as soon as the run is spawned, so the pane shows it running.
- Per-job IANA time zone; without one the daemon's zone applies.
- Stop a running job: SIGTERM to its process group, recorded as a non-zero run.
- Clear log: empties a job's log without touching its run history.
- Follow re-reads the log tail instead of borrowing a workspace terminal for
  `tail -f`: one less moving part, no workspace required, nothing left running.
- Cron's day-of-month / day-of-week **or** semantics; no cartesian-product entry
  cap.
- Job store, logs and history in `$PASEO_HOME/plugin-data/paseo-cron/`.
- Removed: plists, `launchctl`/`plutil` calls, launchd status parsing, legacy
  data migration, the macOS-only screen state.
