import { sameLogin } from "../shared/github";
import type { Feed, Item, PullRequestItem } from "../shared/github";

export const REFRESH_MS = 60_000;
export const AGE_DANGER_DAYS = 90;

export type ChipTone = "neutral" | "good" | "warn" | "danger";

export interface Chip {
  text: string;
  tone: ChipTone;
}

export function ageDays(updatedAt: string, now = Date.now()): number {
  const then = Date.parse(updatedAt);
  if (!Number.isFinite(then)) return 0;
  return Math.floor((now - then) / 86_400_000);
}

export function ageLabel(updatedAt: string, now = Date.now()): string {
  const then = Date.parse(updatedAt);
  if (!Number.isFinite(then)) return "unknown";
  const elapsed = now - then;
  if (elapsed < 60_000) return "just now";

  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

export function isAgeDanger(updatedAt: string, now = Date.now()): boolean {
  return ageDays(updatedAt, now) > AGE_DANGER_DAYS;
}

export function sidebarCount(feed: Feed): number {
  return feed.groups.yourPrs.length + feed.groups.incoming.length;
}

export function isAuthored(item: Item, viewer: string): boolean {
  return sameLogin(item.author.login, viewer);
}

export function isReviewRequested(item: Item, viewer: string): boolean {
  return (
    item.kind === "pull_request" &&
    item.requestedReviewers.some(function (reviewer) {
      return sameLogin(reviewer.login, viewer);
    })
  );
}

export function ownsRepo(repo: string, owners: readonly string[]): boolean {
  const owner = repo.split("/")[0] ?? "";
  return owners.some(function (candidate) {
    return sameLogin(candidate, owner);
  });
}

export function aggregateChip(item: PullRequestItem): Chip | null {
  if (item.reviewDecision === "APPROVED") return { text: "Approved", tone: "good" };
  if (item.reviewDecision === "CHANGES_REQUESTED") {
    return { text: "Changes requested", tone: "danger" };
  }
  if (item.reviewDecision === "REVIEW_REQUIRED") {
    return { text: "Review required", tone: "warn" };
  }
  return null;
}

export function viewerReviewChip(item: PullRequestItem, viewer: string): Chip {
  const review = item.reviews.find(function (candidate) {
    return sameLogin(candidate.login, viewer);
  });
  if (!review) return { text: "Needs review", tone: "warn" };
  if (review.state === "APPROVED") return { text: "You approved", tone: "good" };
  if (review.state === "CHANGES_REQUESTED") {
    return { text: "You requested changes", tone: "danger" };
  }
  if (review.state === "COMMENTED") return { text: "You commented", tone: "neutral" };
  return { text: "Your review was dismissed", tone: "neutral" };
}

export function itemChips(item: Item, viewer: string, owners: readonly string[]): Chip[] {
  const chips: Chip[] = [];
  const authored = isAuthored(item, viewer);
  const reviewRequested = isReviewRequested(item, viewer);
  const owned = ownsRepo(item.repo, owners);

  if (item.kind === "pull_request") {
    if (item.isDraft) chips.push({ text: "Draft", tone: "neutral" });
    if (authored) {
      const aggregate = aggregateChip(item);
      if (aggregate) chips.push(aggregate);
    } else if (
      reviewRequested ||
      item.reviews.some(function (review) {
        return sameLogin(review.login, viewer);
      })
    ) {
      chips.push(viewerReviewChip(item, viewer));
    }
    if (item.mergeable === "conflicting") {
      chips.push({ text: "Conflicts", tone: "danger" });
    }
  }

  if (authored && item.kind === "pull_request" && reviewRequested) {
    chips.push({ text: "Review requested", tone: "neutral" });
  }
  if (item.assignedToViewer) chips.push({ text: "Assigned", tone: "warn" });
  if (owned) chips.push({ text: "Owned", tone: "neutral" });

  return chips;
}

export function checksLabel(checks: PullRequestItem["checks"]): string {
  if (checks === "passing") return "Passing";
  if (checks === "failing") return "Failing";
  if (checks === "pending") return "Pending";
  return "No checks";
}

export function mergeableLabel(mergeable: PullRequestItem["mergeable"]): string {
  if (mergeable === "mergeable") return "Mergeable";
  if (mergeable === "conflicting") return "Conflicts with base";
  return "Mergeability unknown";
}

export function reviewStateLabel(
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED",
): string {
  if (state === "APPROVED") return "Approved";
  if (state === "CHANGES_REQUESTED") return "Changes requested";
  if (state === "COMMENTED") return "Commented";
  return "Dismissed";
}
