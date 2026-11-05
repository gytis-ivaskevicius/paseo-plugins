# AGENTS.md

A Paseo plugin that adds a **Cron jobs** screen and sidebar row: shell
commands on a cron expression or a fixed interval, run by the Paseo daemon
itself. There is no launchd, systemd or crontab involvement anywhere.

Forked from `gpambrozio/paseo-plugins/launchd-jobs`; the client, the cron parser
and the failure badge are its work.

## Orientation

| File                       | What it owns                                                                  |
| -------------------------- | ----------------------------------------------------------------------------- |
| `index.server.ts` / `index.client.tsx` | Wiring only — the nine RPC contracts, the scheduler's start/stop, the screen and row. |
| `shared/jobs.ts`           | The zod contracts and the `Job` shape both halves agree on.                    |
| `shared/cron.ts`           | Five-field parsing and the sentences the form previews. No Node imports.       |
| `server/store.ts`          | `jobs.json`, the log and run files, acknowledgements, atomic writes.           |
| `server/scheduler.ts`      | Croner instances, `spawn`, streaming into the log, the run record, overlap guard. |
| `server/jobs.ts`           | The handlers, slugging, and the `Job` composition the screen renders.          |
| `server/data-dir.ts`       | `$PASEO_HOME/plugin-data/paseo-cron/`.                                         |
| `client/jobs.tsx`          | The screen: list, detail pane, create/edit form.                              |
| `client/screen.ts`         | The screen id, the `job` param, and how that param seeds the pane.             |
| `client/sidebar-item.tsx`  | The sidebar row, its failing-count badge and the popover.                      |
| `client/log-follow.ts`     | Follow mode: the `tail -f` terminal behind the log pane.                       |
| `client/failure-alert.ts`  | The 60-second health poll and the store of failing jobs.                       |
| `server/jobs.test.ts`      | End-to-end: store, arming, spawning, history, health, delete.                  |
| `server/host-imports.test.ts` | The import-graph check every plugin in this repo carries.                    |

## The daemon is the scheduler

`contribute(server)` arms every enabled job from `jobs.json` and returns a
cleanup that stops the timers. Between those two points the plugin's server
subprocess is the only thing keeping time; no OS facility is configured, so
nothing outlives the daemon and nothing has to be removed from the machine.

That has three consequences that the code must keep true:

- **Every run must be recorded by us.** There is no launcher script writing a
  history line for us. `fire()` writes the start marker, streams the child's
  output into the log, waits for the stream to flush, then appends the run
  record — and `runJobHandler` awaits that, so "Run now" never returns before
  the run is visible.
- **A stopped daemon misses runs.** Do not add catch-up logic: it would re-fire
  every job on every restart, and a restart is not a wake-from-sleep. Croner
  already fires a late trigger once and skips the missed occurrences.
- **Overlaps are skipped, not queued.** `fire` checks the running set first and
  writes a skip line. A job slower than its interval is a mis-set schedule.

## Schedules

Cron expressions are five fields, validated by `shared/cron.ts` for the form and
by constructing a `Cron` in `assertSchedulable` for the server. Fixed intervals
are `new Cron("* * * * * *", { interval: seconds })` — croner's way of saying
"at most one trigger every N seconds", which is the only way to name an
arbitrary period.

A job may name an IANA zone; `arm` hands it to croner, and `null` means the
daemon's own zone. `assertZone` rejects a zone this host cannot resolve, because
an unknown zone would arm and then fire at the wrong time rather than not at
all.

A job that cannot be armed (`problem !== null`) still lives in the store, so the
user can see and fix it; it simply has no timer.

## The store

`jobs.json` is written whole through a temporary file, and every read-modify-
write goes through `mutate` so two concurrent RPCs cannot drop one of the other's
edits. Logs and history are append-only; compaction keeps the last 200 runs.
`acknowledged.json` remembers which failure the user has seen, keyed by the run's
`startedAt` — the one fact the run files cannot hold.

## Client notes

- Async **function expressions**, never async arrows: Hermes evaluates an async
  arrow to `undefined` when the app `eval`s the bundle. Same reason list
  closures go through `.map`, never a `for…of` body.
- React Native primitives only; every colour comes from `theme.colors`.
- The screen caches its list, pane and in-progress draft at module scope,
  because Paseo unmounts it on navigation.
- The client must never import `server/` or croner: it cannot resolve them.

## Checks

```bash
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin ls          # expect `running`
paseo plugin logs paseo-cron
```
