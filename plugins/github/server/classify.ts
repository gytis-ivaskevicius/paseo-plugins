import { sameLogin, sortItems } from "../shared/github";
import type { Feed, IssueItem, Item, PullRequestItem } from "../shared/github";
import type { PullRequestNode, SearchNode } from "./queries";

function checksOf(state: string | null | undefined): PullRequestItem["checks"] {
  if (!state) return "none";
  if (state === "SUCCESS" || state === "NEUTRAL" || state === "SKIPPED") return "passing";
  if (state === "FAILURE" || state === "ERROR") return "failing";
  return "pending";
}

function mergeableOf(state: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"): PullRequestItem["mergeable"] {
  if (state === "MERGEABLE") return "mergeable";
  if (state === "CONFLICTING") return "conflicting";
  return "unknown";
}

function authorOf(node: SearchNode): Item["author"] {
  const author = node.author;
  if (!author) return { login: "ghost", avatarUrl: null, isBot: false };
  return {
    login: author.login,
    avatarUrl: author.avatarUrl,
    isBot: author.__typename === "Bot" || author.login.endsWith("[bot]"),
  };
}

type ItemBase = Omit<IssueItem, "kind">;

function baseItem(node: SearchNode, viewer: string): ItemBase {
  const repo = node.repository.nameWithOwner;
  return {
    key: `${repo}#${node.number}`,
    repo,
    number: node.number,
    title: node.title,
    url: node.url,
    body: node.body ?? "",
    author: authorOf(node),
    assignedToViewer: node.assignees.nodes.some(function (assignee) {
      return sameLogin(assignee.login, viewer);
    }),
    labels: node.labels.nodes,
    commentCount: node.comments.totalCount,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

interface ReviewerNode {
  login: string;
  avatarUrl: string | null;
}

function toPullRequest(
  node: PullRequestNode,
  viewer: string,
): PullRequestItem {
  const requestedReviewers = node.reviewRequests.nodes
    .map(function (entry) {
      return entry.requestedReviewer;
    })
    .filter(function (reviewer): reviewer is ReviewerNode {
      return reviewer !== null && typeof reviewer.login === "string";
    })
    .map(function (reviewer) {
      return { login: reviewer.login, avatarUrl: reviewer.avatarUrl ?? null };
    });

  const reviews = node.latestReviews.nodes
    .filter(function (review) {
      return (
        review.author !== null &&
        review.state !== "PENDING" &&
        review.submittedAt !== null
      );
    })
    .map(function (review) {
      return {
        login: review.author?.login ?? "ghost",
        avatarUrl: review.author?.avatarUrl ?? null,
        state: review.state as "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED",
        submittedAt: review.submittedAt as string,
      };
    });

  return {
    ...baseItem(node, viewer),
    kind: "pull_request",
    isDraft: node.isDraft,
    reviewDecision: node.reviewDecision,
    mergeable: mergeableOf(node.mergeable),
    checks: checksOf(node.commits.nodes[0]?.commit.statusCheckRollup?.state),
    requestedReviewers,
    reviews,
  };
}

export function toItem(node: SearchNode, viewer: string): Item {
  if (node.__typename === "PullRequest") return toPullRequest(node, viewer);
  return { ...baseItem(node, viewer), kind: "issue" };
}

export function classify(
  viewer: string,
  owners: readonly string[],
  nodes: readonly SearchNode[],
): Feed["groups"] {
  const byKey = new Map<string, Item>();
  nodes.forEach(function (node) {
    const item = toItem(node, viewer);
    if (!byKey.has(item.key)) byKey.set(item.key, item);
  });

  const yourPrs: Item[] = [];
  const incoming: Item[] = [];
  const bots: Item[] = [];
  const myIssues: Item[] = [];

  byKey.forEach(function (item) {
    if (sameLogin(item.author.login, viewer)) {
      if (item.kind === "pull_request") yourPrs.push(item);
      else myIssues.push(item);
      return;
    }

    const reviewRequested =
      item.kind === "pull_request" &&
      item.requestedReviewers.some(function (reviewer) {
        return sameLogin(reviewer.login, viewer);
      });
    const owned = owners.some(function (owner) {
      return sameLogin(owner, item.repo.split("/")[0] ?? "");
    });
    if (!reviewRequested && !item.assignedToViewer && !owned) return;

    if (item.author.isBot) bots.push(item);
    else incoming.push(item);
  });

  return {
    yourPrs: sortItems(yourPrs),
    incoming: sortItems(incoming),
    bots: sortItems(bots),
    myIssues: sortItems(myIssues),
  };
}
