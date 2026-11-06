import { describe, expect, it } from "vitest";
import type { Item, PullRequestItem } from "../shared/github";
import {
  ageDays,
  aggregateChip,
  isAgeDanger,
  itemChips,
  sidebarCount,
  viewerReviewChip,
} from "./view";

const NOW = Date.parse("2026-04-01T00:00:00Z");

function pullRequest(overrides: Partial<PullRequestItem> = {}): PullRequestItem {
  return {
    key: "vi-tality/repo#1",
    repo: "vi-tality/repo",
    number: 1,
    title: "A pull request",
    url: "https://github.com/vi-tality/repo/pull/1",
    body: "",
    author: { login: "viewer", avatarUrl: null, isBot: false },
    assignedToViewer: false,
    labels: [],
    commentCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-03-31T00:00:00Z",
    kind: "pull_request",
    isDraft: false,
    reviewDecision: null,
    mergeable: "mergeable",
    checks: "passing",
    requestedReviewers: [],
    reviews: [],
    ...overrides,
  };
}

function chipTexts(item: Item, owners: readonly string[] = []): string[] {
  return itemChips(item, "viewer", owners).map(function (chip) {
    return chip.text;
  });
}

describe("age", function () {
  it("counts whole days since the update", function () {
    expect(ageDays("2026-03-30T00:00:00Z", NOW)).toBe(2);
  });

  it("flags an item older than 90 days", function () {
    expect(isAgeDanger("2025-12-31T00:00:00Z", NOW)).toBe(true);
    expect(isAgeDanger("2026-01-01T00:00:00Z", NOW)).toBe(false);
  });
});

describe("chips", function () {
  it("shows the authored aggregate decision", function () {
    expect(aggregateChip(pullRequest({ reviewDecision: "APPROVED" }))?.text).toBe("Approved");
    expect(aggregateChip(pullRequest({ reviewDecision: "CHANGES_REQUESTED" }))?.text).toBe(
      "Changes requested",
    );
    expect(aggregateChip(pullRequest({ reviewDecision: "REVIEW_REQUIRED" }))?.text).toBe(
      "Review required",
    );
  });

  it("derives the aggregate decision from reviews when GitHub reports none", function () {
    const approved = pullRequest({
      reviews: [
        {
          login: "someone",
          avatarUrl: null,
          state: "APPROVED",
          submittedAt: "2026-03-30T00:00:00Z",
        },
      ],
    });
    expect(aggregateChip(approved)?.text).toBe("Approved");

    const changes = pullRequest({
      reviews: [
        {
          login: "someone",
          avatarUrl: null,
          state: "CHANGES_REQUESTED",
          submittedAt: "2026-03-30T00:00:00Z",
        },
      ],
    });
    expect(aggregateChip(changes)?.text).toBe("Changes requested");
  });

  it("shows the viewer's own review on an incoming pull request", function () {
    const item = pullRequest({
      author: { login: "someone", avatarUrl: null, isBot: false },
      requestedReviewers: [{ login: "viewer", avatarUrl: null }],
      reviews: [
        {
          login: "viewer",
          avatarUrl: null,
          state: "APPROVED",
          submittedAt: "2026-03-30T00:00:00Z",
        },
      ],
    });
    expect(viewerReviewChip(item, "viewer").text).toBe("You approved");
    expect(chipTexts(item, ["vi-tality"])).toContain("You approved");
  });

  it("falls back to Needs review when the viewer has no review row", function () {
    const item = pullRequest({
      author: { login: "someone", avatarUrl: null, isBot: false },
      requestedReviewers: [{ login: "viewer", avatarUrl: null }],
    });
    expect(viewerReviewChip(item, "viewer").text).toBe("Needs review");
  });

  it("shows the viewer's review on an owned repo after the request clears", function () {
    const item = pullRequest({
      author: { login: "someone", avatarUrl: null, isBot: false },
      reviews: [
        {
          login: "viewer",
          avatarUrl: null,
          state: "APPROVED",
          submittedAt: "2026-03-30T00:00:00Z",
        },
      ],
    });
    expect(chipTexts(item, ["vi-tality"])).toContain("You approved");
  });

  it("shows draft, conflicts, assigned and owned on an incoming item", function () {
    const item = pullRequest({
      author: { login: "someone", avatarUrl: null, isBot: false },
      isDraft: true,
      mergeable: "conflicting",
      assignedToViewer: true,
    });
    expect(chipTexts(item, ["vi-tality"])).toEqual([
      "Draft",
      "Conflicts",
      "Assigned",
      "Owned",
    ]);
  });
});

describe("sidebarCount", function () {
  it("counts your PRs and incoming only", function () {
    const feed = {
      viewer: "viewer",
      fetchedAt: "2026-04-01T00:00:00Z",
      error: null,
      groups: {
        yourPrs: [pullRequest()],
        incoming: [pullRequest({ number: 2 })],
        bots: [pullRequest({ number: 3 })],
        myIssues: [],
      },
    };
    expect(sidebarCount(feed)).toBe(2);
  });
});
