# GitHub

One worklist for the GitHub work that is actually outstanding: pull requests you
authored, items waiting on you, and a collapsed tail of bot pull requests.

## What it does

The screen has three sections:

- **Your PRs** — every open pull request you authored, in any repository.
- **Incoming** — open items in your owner list, review requests addressed to you,
  and anything assigned to you. Bot-authored items sit under a collapsed
  **Bots (N)** divider.
- **My issues** — open issues you authored, collapsed by default.

Select a row for the detail pane: description, comment count, pending review
requests, every reviewer's latest state, check and mergeability summaries, and
the aggregate review decision on your own pull requests. On a narrow window the
detail opens as a sheet over the list.

From the detail pane you can open the item on GitHub, start or reopen a Paseo
agent session for it, and request a review from a repository collaborator.

## Requirements

Paseo 0.11 or newer. The daemon host needs the GitHub CLI on its `PATH`, logged
in with `gh auth login`. Private organization repositories need the `repo` and
`read:org` scopes.

## Configuration

The default owner list is your own login plus the organizations you belong to.
Edit it in **Settings → GitHub** as a comma-separated list. Your own login must stay
in the list. The next refresh uses the new owners without a restart.

Owners live in `$PASEO_HOME/plugin-data/paseo-github/config.json`. Writes are
atomic. No token is stored or forwarded: every request uses the daemon's
existing `gh` login.

## Limits

A refresh runs every 60 seconds and costs `2 × owners + 5` GitHub searches. Each
search returns at most 50 items. Review requests from a team do not appear,
because the search matches requests addressed to you as an individual. There is
no history, merge, approve, close, or notification handling.
