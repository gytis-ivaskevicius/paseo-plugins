import { describe, expect, it } from "vitest";
import { classify } from "./classify";
import type { SearchNode } from "./queries";

function node(input: {
  typename?: "PullRequest" | "Issue";
  repo?: string;
  number?: number;
  author?: string;
  authorType?: "User" | "Bot";
  assignees?: string[];
  requested?: string[];
  updatedAt?: string;
}): SearchNode {
  const typename = input.typename ?? "PullRequest";
  const base = {
    number: input.number ?? 1,
    title: "A title",
    url: "https://github.com/vi-tality/repo/pull/1",
    body: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: input.updatedAt ?? "2026-01-01T00:00:00Z",
    author: {
      __typename: input.authorType ?? "User",
      login: input.author ?? "viewer",
      avatarUrl: null,
    },
    repository: { nameWithOwner: input.repo ?? "vi-tality/repo" },
    assignees: {
      nodes: (input.assignees ?? []).map(function (login) {
        return { login };
      }),
    },
    comments: { totalCount: 0 },
    labels: { nodes: [] },
  };

  if (typename === "Issue") return { __typename: "Issue", ...base };

  return {
    __typename: "PullRequest",
    ...base,
    isDraft: false,
    reviewDecision: null,
    mergeable: "MERGEABLE",
    reviewRequests: {
      nodes: (input.requested ?? []).map(function (login) {
        return {
          requestedReviewer: { __typename: "User", login, avatarUrl: null },
        };
      }),
    },
    latestReviews: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  };
}

describe("classify", function () {
  it("puts the viewer's authored pull requests in yourPrs", function () {
    const groups = classify("viewer", ["vi-tality"], [node({})]);
    expect(groups.yourPrs.map(function (item) {
      return item.key;
    })).toEqual(["vi-tality/repo#1"]);
    expect(groups.incoming).toHaveLength(0);
  });

  it("puts a review request to the viewer in incoming", function () {
    const groups = classify("viewer", ["vi-tality"], [
      node({ author: "someone", requested: ["viewer"] }),
    ]);
    expect(groups.incoming).toHaveLength(1);
    expect(groups.incoming[0]?.assignedToViewer).toBe(false);
  });

  it("puts an assigned issue to the viewer in incoming", function () {
    const groups = classify("viewer", ["vi-tality"], [
      node({ typename: "Issue", author: "someone", assignees: ["viewer"] }),
    ]);
    expect(groups.incoming).toHaveLength(1);
    expect(groups.incoming[0]?.kind).toBe("issue");
  });

  it("puts anything in an owned repo in incoming", function () {
    const groups = classify("viewer", ["vi-tality"], [node({ author: "someone" })]);
    expect(groups.incoming).toHaveLength(1);
  });

  it("puts bot-authored items in bots", function () {
    const groups = classify("viewer", ["vi-tality"], [
      node({ author: "dependabot[bot]", authorType: "Bot" }),
    ]);
    expect(groups.bots).toHaveLength(1);
    expect(groups.incoming).toHaveLength(0);
  });

  it("ignores items that touch neither the viewer nor an owner", function () {
    const groups = classify("viewer", ["vi-tality"], [
      node({ repo: "elsewhere/repo", author: "someone" }),
    ]);
    expect(groups.yourPrs).toHaveLength(0);
    expect(groups.incoming).toHaveLength(0);
    expect(groups.bots).toHaveLength(0);
  });

  it("deduplicates the same item found by several searches", function () {
    const groups = classify("viewer", ["vi-tality"], [node({}), node({})]);
    expect(groups.yourPrs).toHaveLength(1);
  });

  it("orders each group by most recently updated", function () {
    const groups = classify("viewer", ["vi-tality"], [
      node({ number: 1, updatedAt: "2026-01-01T00:00:00Z" }),
      node({ number: 2, updatedAt: "2026-02-01T00:00:00Z" }),
    ]);
    expect(groups.yourPrs.map(function (item) {
      return item.number;
    })).toEqual([2, 1]);
  });
});
