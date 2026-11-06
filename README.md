# Paseo plugins

Plugins for [Paseo](https://paseo.sh), each one self-contained under `plugins/`.
One repository, one CI run, one place to scaffold from.

| Plugin | What it adds | Runtime deps |
| --- | --- | --- |
| [`plugins/cron`](plugins/cron) | A **Cron jobs** screen and sidebar row; the daemon holds the timers | `croner` |
| [`plugins/github`](plugins/github) | A **GitHub** worklist of authored pull requests and incoming items | none |
| [`plugins/secrets`](plugins/secrets) | Browse and edit a `pass` store from a Paseo screen | none |

## Install

Each plugin installs from its own folder. The path after the colon is required:

```bash
paseo plugin add git:gytis-ivaskevicius/paseo-plugins:plugins/cron
paseo plugin add git:gytis-ivaskevicius/paseo-plugins:plugins/github
paseo plugin add git:gytis-ivaskevicius/paseo-plugins:plugins/secrets
```

A Git install runs the `build` command from that plugin's `paseo-plugin.json`, which
installs its runtime dependencies from the committed lock. Plugins with no runtime
dependencies declare no build step.

## Development

Install dependencies inside the plugin folder you are working on; there are no
workspaces, so every plugin keeps its own lockfile and `node_modules`.

```bash
cd plugins/cron
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"     # directory install, no build step
paseo plugin reload paseo-cron  # after editing the source
```

`./scripts/check.sh` (or `npm run check`) runs `npm ci` plus typecheck and tests for
every plugin, which is what CI does.

Plugins are trusted, unsandboxed code: backend code runs on the daemon machine, client
code inside the app.

## Layout

```
plugins/cron/      package.json, package-lock.json, paseo-plugin.json, OVERVIEW.md
plugins/github/    same, no runtime dependencies
plugins/secrets/   same, no runtime dependencies
scripts/check.sh   install + typecheck + test every plugin
.github/workflows  one CI job running scripts/check.sh
```

A plugin's identity comes from `paseo-plugin.json`, not its path, so moving a plugin
between sources keeps its data under `$PASEO_HOME/plugin-data/<id>/`.
