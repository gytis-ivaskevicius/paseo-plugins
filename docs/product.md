# Paseo plugins

A personal workbench for AI-assisted work, built as [Paseo](https://paseo.sh) plugins. Same territory as OpenClaw — scheduled jobs, credentials, repository triage — but OpenClaw is a standalone gateway that owns the chat surface. Here Paseo owns agents and sessions, and each plugin adds one operational surface beside them. The aim is not a better chat client; it is one place where scheduled work, credentials, repositories, and agent sessions are visible and actionable without switching apps.

## Problem

- The state that actually matters lives in four places: systemd timers and crontabs, a `pass` store, GitHub, and the Paseo session list. "What is failing", "what needs me", "what did the agent do" each mean a different tab.
- Agents are good at doing work and bad at remembering what is still pending. A screen that shows pending work is worth more than another prompt.
- Existing Paseo plugins each solve one slice with their own storage, conventions, and UI shape, so combining them costs more than writing the one screen that fits.

## Approach

- One plugin per operational surface, installed independently, sharing no runtime state. A failing plugin must not take the others down.
- The daemon is the execution host: timers, `pass` reads, and `gh` calls run server-side. The client renders and issues intents.
- Local-first. State lives in `$PASEO_HOME/plugin-data/<id>/`, secrets stay in `pass`, and there is no hosted backend.
- No AI logic in the plugins. They surface work and start sessions; the agents do the reasoning.

## Features

### Shipped

- **Cron jobs** — shell commands on a cron expression or fixed interval, scheduled and run by the Paseo daemon itself, with history and a failing-job badge ([plugins/cron](../plugins/cron/OVERVIEW.md)).
- **Secrets** — browse, reveal, add, edit, and delete entries in a `pass` store without decrypting the index ([plugins/secrets](../plugins/secrets/README.md)).

### Planned

- **GitHub worklist** — one screen of authored PRs, other people's PRs and issues in owned repositories, and archived authored issues, with check status and one-tap agent sessions ([story](stories/2026-11-06-github-worklist.md)).

### Direction

- **A dashboard surface** that composes the above into one screen: what failed, what needs a decision, what an agent is waiting on. Not specified yet; it exists only as the reason the individual plugins are worth building.

## Non-goals

- Replacing Paseo's chat or agent surface. Sessions stay in Paseo; plugins add operational views around them.
- Multi-user, hosted, or SaaS. This is a single-operator tool.
- A generic GitHub client, a generic automation platform, or a plugin marketplace.
- Cross-plugin state sharing. Composition happens in the UI and in the daemon's plugin data directories, not in a shared runtime.

## Host Constraints

- Plugins are trusted, unsandboxed code: server code runs on the daemon host and client code inside the app. A careless plugin is a host compromise, which is why plugins stay small and read-mostly.
- Plugin identity is the manifest id, not the folder, so data under `plugin-data/<id>/` survives moves between sources.
- There are no workspaces: every plugin keeps its own lockfile and `node_modules`, and CI installs each one independently.
- The client is React Native Web plus native apps: no DOM, no async arrow functions (Hermes evaluates them to `undefined`), and no imports from `server/` in client code.

## Known Limitations

- Every plugin carries its own `package-lock.json`, so a dependency bump is repeated per plugin.
- The GitHub plugin requires `gh` on the daemon's PATH, authenticated with `repo` and `read:org`.
- The GitHub worklist has no read/snooze state and no history; closed items simply disappear.
- Nothing here is sandboxed or permissioned. Trust is per-plugin and manual.
