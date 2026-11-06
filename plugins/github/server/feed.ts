import { sameLogin } from "../shared/github";
import type { Feed } from "../shared/github";
import { classify } from "./classify";
import { readConfig } from "./config";
import { ownerType, viewerLogin, viewerOrgs } from "./gh";
import { buildSearches, searchNodes, type SearchNode } from "./queries";

interface FeedCache {
  viewer: string;
  nodes: Map<string, SearchNode>;
  fetchedAt: string;
}

let cache: FeedCache | null = null;
let inFlight: Promise<Feed> | null = null;

const ownerTypes = new Map<string, "Organization" | "User">();

function reasonOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function nodeKey(node: SearchNode): string {
  return `${node.repository.nameWithOwner}#${node.number}`;
}

async function typeOf(owner: string): Promise<"Organization" | "User"> {
  const cached = ownerTypes.get(owner);
  if (cached) return cached;
  const type = await ownerType(owner);
  ownerTypes.set(owner, type);
  return type;
}

async function fetchFeed(): Promise<Feed> {
  const viewer = await viewerLogin();
  const config = await readConfig(viewer, { defaultOwners: viewerOrgs });

  const types: Record<string, "Organization" | "User"> = {};
  await Promise.all(
    config.owners.map(async function (owner) {
      types[owner] = await typeOf(owner);
    }),
  );

  const searches = buildSearches(config.owners, types);
  const results = await Promise.allSettled(
    searches.map(function (spec) {
      return searchNodes(spec.query);
    }),
  );

  const fresh = new Map<string, SearchNode>();
  const errors: string[] = [];
  results.forEach(function (result, index) {
    if (result.status === "fulfilled") {
      result.value.forEach(function (node) {
        fresh.set(nodeKey(node), node);
      });
      return;
    }
    errors.push(`${searches[index]?.label ?? "search"}: ${reasonOf(result.reason)}`);
  });

  const previous =
    cache !== null && sameLogin(cache.viewer, viewer) ? cache : null;
  const nodes = errors.length === 0 ? new Map(fresh) : new Map(previous?.nodes ?? []);
  if (errors.length > 0) {
    fresh.forEach(function (node, key) {
      nodes.set(key, node);
    });
  }

  const fetchedAt =
    errors.length === 0
      ? new Date().toISOString()
      : previous?.fetchedAt ?? new Date().toISOString();

  if (errors.length === 0 || previous !== null) {
    cache = { viewer, nodes, fetchedAt };
  }

  return {
    viewer,
    fetchedAt,
    error: errors.length > 0 ? errors.join("; ") : null,
    groups: classify(viewer, config.owners, Array.from(nodes.values())),
  };
}

export function listFeed(force = false): Promise<Feed> {
  const current = inFlight;
  if (current !== null) {
    if (!force) return current;
    return current.then(function () {
      return listFeed(true);
    });
  }
  inFlight = fetchFeed().finally(function () {
    inFlight = null;
  });
  return inFlight;
}
