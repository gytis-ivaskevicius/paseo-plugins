# GitHub worklist

## Context

Paseo has no view of the GitHub work that is actually outstanding for this account. Attention Span installs, but it is reviewer-shaped: its "mine" bucket is PR-only, it never lists assigned items or other people's items in owned repos, and it splits everything across tabs. The outstanding set is small — a handful of authored PRs, a few incoming human items, and a long tail of dependency PRs — so one flat, sectioned screen shows all of it without a board, tabs, or history.

## Acceptance criteria

- plugin installed with no configuration and `gh` authenticated, Paseo opened
  - → a "GitHub" sidebar row and screen exist
  - → the screen lists authored PRs and incoming items without a plugin-specific setup step

- feed loaded
  - → three groups render in order: "Your PRs", "Incoming", "My issues"
  - → every group header shows its count, and the "Bots" divider inside "Incoming" shows its own count
  - → "Incoming"'s count covers human items only
  - → "My issues" is collapsed by default; expanding it reveals the items

- an open PR authored by the viewer exists in any repo, including orgs outside the owned list
  - → it appears in "Your PRs"
  - → the row shows `owner/repo#number`, title, author avatar, and age
  - → a draft PR also shows a "Draft" chip

- an open PR or issue in an owned repo was authored by someone else
  - → it appears exactly once in "Incoming"

- an open PR anywhere has the viewer as a requested reviewer
  - → it appears exactly once in "Incoming"
  - → its chip is decided by the next two criteria
- that PR is still awaiting the viewer's review and the viewer has not reviewed it
  - → the chip reads "Needs review"
- the viewer has already submitted a review on that PR
  - → the chip shows the viewer's latest review: "You approved", "You requested changes", "You commented", or "Your review was dismissed"
- an authored PR has reviews from others
  - → its chip shows the aggregate decision: "Approved", "Changes requested", or "Review required"
- an authored PR has no reviews and its base branch requires none
  - → no review chip is shown

- an open PR or issue anywhere is assigned to the viewer and not authored by them
  - → it appears exactly once in "Incoming" with an "Assigned" chip
  - → an assigned item outside the owned list appears too

- an item's author is a bot (GraphQL author type `Bot`, or login ending in `[bot]`)
  - → it does not appear in the human "Incoming" list
  - → it appears under a collapsed "Bots (N)" divider inside "Incoming"
  - → expanding the divider reveals it
  - → assigning a bot item to the viewer does not move it out of the bot list

- default owner list is the viewer plus `vi-tality` and `DevPalace`
  - → "Incoming" contains items from those owners and from no other owner
  - → an `NixOS` PR authored by the viewer appears in "Your PRs", while `NixOS` items authored by others appear only if assigned to or review-requested from the viewer

- the owner list is edited in the plugin settings screen
  - → the next refresh reflects the new list, with no restart
- the owner list is cleared and saved
  - → the save is refused with a message, and the previous list stays in effect

- an item is authored by the viewer and also assigned to them and also in an owned repo
  - → it renders exactly once
  - → it lands in the highest-precedence group, ordered: authored, review-requested, assigned or owned
  - → its row carries badges for the lower-precedence matches
- an item is review-requested from the viewer and sits in an owned repo
  - → it renders once in "Incoming", not twice
  - → it carries both the review chip and the owned-repo badge

- a group holds several items
  - → rows are sorted by last update, newest first
  - → each row shows its age
  - → the age text uses the danger color when the last update is older than 90 days

- a row is selected
  - → a detail pane shows title, body, author, comment count, the pending review requests ("waiting on"), every reviewer with their latest state, the aggregate decision on authored PRs, and, for PRs, the check summary
  - → on a narrow window the detail opens as a sheet over the list instead

- "Open on GitHub" is pressed
  - → the item's URL opens in the system browser

- "Start agent" is pressed for an item whose repo is a registered Paseo project
  - → a new agent session starts in a worktree of that project
  - → the session carries a label identifying the item
- "Start agent" is pressed again for the same item
  - → the existing labelled session opens; no second session is created
- "Start agent" is unavailable for a repo with no registered Paseo project
  - → the action is disabled and states that the repo must be added as a project

- "Request review" is pressed on a PR
  - → a picker lists that repo's collaborators
  - → choosing one requests their review on GitHub
  - → after the next refresh the requested login is listed on the row and in the detail pane
- the collaborator list cannot be read (no admin access to the repo)
  - → the picker shows GitHub's error text instead of an empty list
  - → the rest of the detail pane still works
- "Request review" is pressed on an issue
  - → the action is absent

- the screen has been open for a minute
  - → data refreshes automatically
  - → a manual refresh control fetches immediately
  - → an "Updated <time>" label reflects the last successful fetch

- a refresh fails
  - → an error banner appears
  - → previously loaded items stay visible

- `gh` is missing from the daemon's PATH or is not authenticated
  - → the screen shows a setup state naming the command needed to authenticate
  - → no crash and no misleading empty list

- a feed is loaded
  - → the sidebar row shows the count of "Your PRs" plus human "Incoming" items
  - → bots and authored issues are excluded from that count

- a group has no items
  - → its header shows 0 and a short empty label
  - → the other groups still render

- an item is closed or merged on GitHub
  - → it disappears at the next refresh
  - → no history or done view exists

## Out of scope

- Merge, approve, close, reopen, or update-branch from the plugin.
- Read/dismiss/snooze state on items.
- Filtering or collapsing items by age; the age label is the only staleness signal.
- Discussions, notifications, mentions, and issue-to-PR linking.
- Team review requests. `user-review-requested:@me` matches requests addressed to the viewer as an individual, so a PR that requests review from one of the viewer's teams does not appear.
- Multiple GitHub hosts, multiple accounts, or token management; authentication is `gh`'s.
- A board, kanban columns, or drag-and-drop.

## Contracts

`shared/github.ts` — the only shapes crossing between client and server.

```ts
export interface BaseItem {
  key: string;              // "owner/repo#123", unique across the feed
  number: number;
  title: string;
  url: string;
  repo: string;             // "owner/repo"
  author: { login: string; avatarUrl: string | null; isBot: boolean };
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601; the only time field, age is derived from it
  assignedToViewer: boolean;
  commentCount: number;
  labels: { name: string; color: string }[];
}

export interface PullRequestItem extends BaseItem {
  kind: "pull_request";
  isDraft: boolean;
  requestedReviewers: RequestedReviewer[];  // users asked and not yet reviewed
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  reviews: ReviewerState[];      // latest review per reviewer, at most 20
  checks: "passing" | "failing" | "pending" | "none";
  mergeable: "mergeable" | "conflicting" | "unknown";
}

export interface RequestedReviewer {
  login: string;
  avatarUrl: string | null;
}

export interface ReviewerState {
  login: string;
  avatarUrl: string | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
  submittedAt: string;           // ISO 8601
}

export interface IssueItem extends BaseItem {
  kind: "issue";
}

export type Item = PullRequestItem | IssueItem;

export interface Feed {
  viewer: string;
  groups: {
    yourPrs: Item[];
    incoming: Item[];       // human authors only
    bots: Item[];           // bot authors, including those in owned repos
    myIssues: Item[];
  };
  fetchedAt: string;        // ISO 8601, last successful fetch
  error: string | null;     // last refresh failure; groups then hold the previous fetch
}

export interface Config {
  owners: string[];         // logins and org names whose open items fill "Incoming"
}
```

RPC surface, all `defineRpc` from `@getpaseo/plugin`:

- `github.list` — input `{ force?: boolean }`, output `Feed`.
- `github.config.read` — input `{}`, output `Config`.
- `github.config.write` — input `Config`, output `Config`; rejects a list that is empty or omits the viewer's login, with an error the settings screen shows.
- `github.collaborators` — input `{ repo: string }`, output `{ users: RequestedReviewer[] }`.
- `github.requestReview` — input `{ repo: string; number: number; login: string }`, output `{ ok: true }`; a GitHub error returns an RPC error whose message is shown in the detail pane.

Config file: `$PASEO_HOME/plugin-data/paseo-github/config.json`, `{ "owners": ["gytis-ivaskevicius", "vi-tality", "DevPalace"] }`. A missing file means those defaults; a write is atomic through a temporary file.

## Notes

**Why the owner list and not `user:@me`.** GitHub's `user:` qualifier matches repositories owned by the user, not org repositories, and combining `user:@me` with `org:` is an AND that matches nothing. One search per owner is the only correct shape. The feed therefore costs 2 × `owners` + 5 searches per refresh: authored PRs, authored issues, review requests, assigned PRs, assigned issues, plus one PR and one issue search per owner. The default owner list is the viewer plus `vi-tality` and `DevPalace`. `NixOS`, `EpicGames`, `ngi-nix`, and `dev-bud` are excluded by default and can be added in settings.

**Chosen defaults, not derived facts.** A 60-second refresh cadence, the 90-day age threshold, and the sidebar count (`yourPrs + human incoming`) are product choices. Each is cheap to change; none should be hard-coded in more than one place. The age threshold is a color only — nothing is hidden or collapsed by age.

**Search constraints.** Authenticated search allows 30 requests per minute; a refresh at 60-second intervals uses about a third of that. Search returns at most 1,000 results per query, and the plugin requests `first: 50` per query, which exceeds every current bucket. Aliasing all searches into a single GraphQL request serializes them server-side; issuing them in parallel from the daemon is acceptable and is what Attention Span does. A partially failed search must not discard the searches that succeeded.

**Two review signals.** `reviewDecision` is GitHub's PR-wide aggregate over everyone's reviews; it answers "can this merge" and is what authored PRs show. `reviews` is the latest review per reviewer, taken from the same `latestReviews` connection in the same request; the viewer's own row in it answers "did I already approve this or ask for changes" and is what incoming PRs show. Keep both: `reviewDecision` accounts for stale approvals and branch-protection requirements, which the per-reviewer array cannot reconstruct, so the aggregate must not be derived from `reviews`.

**Derived fields stay derived.** The feed sends `updatedAt`, not an age; one client helper computes age from it so sorting and display cannot disagree. Every timestamp in the contract is an ISO 8601 string: the RPC payload is JSON, so a `Date` would be re-serialized to a string anyway and arrive without a type guarantee. Parse once at the display edge; ISO strings already sort correctly. The same rule applies to `requestedReviewers` — a review owed by the viewer is `requestedReviewers.some((reviewer) => reviewer.login === viewer)`, not a second boolean.

**Review arrays.** `latestReviews(first: 20)` returns one row per reviewer, already deduplicated to their latest review, with no extra request. It excludes drafts, so `PENDING` never appears. It is capped at 20 reviewers; a PR with more than 20 reviewers may omit the viewer's own row, in which case the chip falls back to "Needs review" and the detail pane states that the reviewer list is truncated. A review by a deleted user normalizes to `ghost`, same as an item author.

**Requested reviewers.** `reviewRequests(first: 10)` is a different set from `reviews`: people asked to review who have not reviewed yet. GitHub's `ReviewRequest` object carries no timestamp — only the requested reviewer, an id, and a code-owner flag — so a pending request cannot have a date; dates exist only on submitted reviews. Team requests are out of scope, matching the search behaviour.

**Null review states.** `reviewDecision: null` means the PR has no reviews and its base branch requires none — not an error — and the row shows no review chip. `mergeable: "unknown"` means GitHub is still computing mergeability; the row shows no conflict chip rather than a guess. `reviews: []` means nobody has reviewed. `avatarUrl: null` only occurs for a normalized `ghost` actor and renders as a placeholder.

**Transport.** `gh api graphql` is the transport; no GitHub SDK. It reuses the operator's existing login, so there is no token to store, refresh, or leak, and one request returns a whole feed. Octokit would either need its own token — a second credential path, and the wrong shape for a local single-operator tool — or shell out to `gh` anyway. Spawn `gh api graphql --input -` with the JSON body on stdin so query length never hits an argument limit, and validate the response with a zod schema so a GitHub schema change fails loudly instead of producing a half-empty screen.

**Grouping is a function of the node.** `viewerDidAuthor`, `requestedReviewers`, owner membership, and `isBot` all come from the PR or issue itself, not from which search returned it. Merge every search's results by `key` before grouping, so an item found by two searches renders once and its badges are the union of the matches.

**Bot detection.** GraphQL `author.__typename === "Bot"` covers GitHub Apps (Dependabot, Renovate). The `[bot]` login suffix is the fallback. Both are needed: some app-authored PRs report `Bot`, some report `User` with the suffix. A deleted author is normalized to login `ghost` with a null avatar; old issues do have them.

**Auth.** The daemon's existing `gh` login is the only credential; scopes `repo` and `read:org` are required for private org repositories. No token is read, stored, or forwarded. `gh` is spawned, never shell-interpolated.

**Session labels.** An agent started from the plugin carries `paseo-github=1` and `paseo-github-item=<key>`. The second label is the lookup used to reopen an existing session instead of creating a duplicate. These names are a contract with the client; do not rename them after the first release without migrating existing agents.

**Reuse.** `runGh`/`graphql` from Attention Span (`https://github.com/andrioid/paseo-attention-span`, MIT) is the reference for spawning `gh` and unwrapping GraphQL errors; its `client/markdown.tsx` is the reference for rendering an item body; the session-launch flow in its `client/sessions.ts` is the reference for resolving a repo to a registered Paseo project and starting a labelled agent. Copy the small pieces with attribution in `OVERVIEW.md`; do not fork the classifier, the coverage model, or the tabbed screen.

**Client constraints inherited from this repo.** Async function expressions, never async arrows (Hermes evaluates async arrows to `undefined`). List rendering through `.map`, never a `for…of` body. React Native primitives only; colors from `theme.colors`. The client must not import `server/`. Screen state cached at module scope because Paseo unmounts the screen on navigation.

**Starting points.** New plugin at `plugins/github/`, plugin id `paseo-github`, sidebar label `GitHub`, following `plugins/cron/` for the manifest, lockfile, `index.server.ts` / `index.client.tsx` split, `shared/` contracts, and `server/host-imports.test.ts`. Add the plugin to `docs/product.md` only after it ships, and correct the entry there if the shipped behavior differs. The installed Attention Span source is at `~/.paseo/plugins/attention-span/*/node_modules/@andrioid/paseo-attention-span` for reference; the version changes on update, so cite the repository in code comments, not that path.

**Verification.** `scripts/check.sh` must pass (typecheck plus tests per plugin). Server-side queries and classification are testable against recorded GraphQL fixtures: an authored PR that is also review-requested must classify once; a `[bot]` author must land in `bots`; an `NixOS` item authored by someone else must be absent.
