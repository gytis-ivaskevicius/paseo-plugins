# GitHub worklist

A Paseo screen that shows the GitHub work outstanding for one account. It is
deliberately smaller than a GitHub client: no board, no tabs, no history, no
merge button.

## Why it exists

Attention Span installs and works, but it is reviewer-shaped. Its "mine" bucket
only covers pull requests, it never lists assigned items or other people's items
in owned repositories, and it splits the result across tabs. The outstanding set
for a normal day is small, so one flat screen is enough.

## How the feed is built

The daemon spawns `gh api graphql --input -` and sends the JSON body on stdin.
No GitHub SDK and no stored token: the operator's existing `gh` login is the
only credential.

Each refresh issues `2 × owners + 5` searches in parallel:

- open pull requests authored by the viewer;
- open issues authored by the viewer;
- open pull requests with a review request addressed to the viewer;
- open pull requests assigned to the viewer and not authored by them;
- open issues assigned to the viewer and not authored by them;
- for every owner, one pull request and one issue search.

The owner searches use `org:` for organizations and `user:` for users. `user:`
matches the user's own repositories, not organizations, so one search per owner
is the only correct shape.

Results are merged by `owner/repo#number` before grouping, so an item found by
two searches renders once and its badges are the union of the matches. Grouping
is a function of the node and the configured owners: authored, review-requested,
owner membership, and bot
authorship all come from the item itself, not from which search returned it.

A search that fails does not discard the searches that succeeded. The previous
feed stays visible behind the error banner until a refresh completes cleanly.

## Review signals

`reviewDecision` is GitHub's pull-request-wide aggregate and is what authored
pull requests show. `latestReviews` supplies the viewer's own latest review and
is what incoming pull requests show. The two are kept separate: the aggregate
accounts for stale approvals and branch protection, which a per-reviewer array
cannot reconstruct.

`latestReviews` is capped at 20 reviewers and excludes drafts. If the viewer's
row falls off the end, the chip falls back to "Needs review" and the detail pane
says the list is truncated.

## Sessions

Starting an agent creates a worktree workspace from the registered Paseo project
whose `projectKey` is `remote:github.com/owner/repo`. A pull request checks out
the change request; an issue branches off the project. The agent carries
`paseo-github=1` and `paseo-github-item=owner/repo#number`. The second label is
the lookup that reopens an existing session instead of creating a duplicate.

These label names are a contract with the client. Do not rename them without
migrating existing agents.

## Files

| Path | What it does |
| --- | --- |
| `shared/github.ts` | The only shapes crossing between client and server, plus the RPC contracts. |
| `server/gh.ts` | Spawns `gh`, unwraps GraphQL errors, and provides the setup errors. |
| `server/queries.ts` | The GraphQL document, search construction, and response validation. |
| `server/classify.ts` | Merges, groups, badges, and sorts the feed. |
| `server/feed.ts` | Runs the searches, keeps the last good feed, and remembers partial failures. |
| `server/config.ts` | Reads and atomically writes the owner list. |
| `client/data.ts` | The shared feed store, the 60-second poll, and the manual refresh. |
| `client/view.ts` | Age, sorting, chips, and sidebar count. |
| `client/sessions.ts` | Project lookup, session lookup, and agent launch. |
| `client/screen.tsx` | The list, detail pane, setup state, and review picker. |
| `client/settings.tsx` | The owner list editor. |

## Attribution

The `gh` spawn and GraphQL error unwrapping are adapted from Attention Span
(`https://github.com/andrioid/paseo-attention-span`, MIT). The session-launch
flow follows its `client/sessions.ts`. The classifier, the coverage model, and
the screen are this plugin's own work.
