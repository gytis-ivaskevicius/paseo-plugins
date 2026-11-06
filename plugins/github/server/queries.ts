import { z } from "zod";
import { graphql } from "./gh";

const ActorSchema = z.object({
  __typename: z.string().nullish(),
  login: z.string(),
  avatarUrl: z.string().nullable(),
});

const RequestedReviewerSchema = z
  .object({
    __typename: z.string().nullish(),
    login: z.string().nullish(),
    avatarUrl: z.string().nullish(),
  })
  .nullable();

const ItemFields = {
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: ActorSchema.nullable(),
  repository: z.object({ nameWithOwner: z.string() }),
  assignees: z.object({ nodes: z.array(z.object({ login: z.string() })) }),
  comments: z.object({ totalCount: z.number().int().nonnegative() }),
  labels: z.object({
    nodes: z.array(z.object({ name: z.string(), color: z.string() })),
  }),
};

export const IssueNodeSchema = z.object({
  __typename: z.literal("Issue"),
  ...ItemFields,
});

export const PullRequestNodeSchema = z.object({
  __typename: z.literal("PullRequest"),
  ...ItemFields,
  isDraft: z.boolean(),
  reviewDecision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]).nullable(),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  reviewRequests: z.object({
    nodes: z.array(z.object({ requestedReviewer: RequestedReviewerSchema })),
  }),
  latestReviews: z.object({
    nodes: z.array(
      z.object({
        author: ActorSchema.nullable(),
        state: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]),
        submittedAt: z.string().nullable(),
      }),
    ),
  }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z.object({ state: z.string() }).nullable(),
        }),
      }),
    ),
  }),
});

export const SearchNodeSchema = z.discriminatedUnion("__typename", [
  PullRequestNodeSchema,
  IssueNodeSchema,
]);

const SearchDataSchema = z.object({
  search: z.object({ nodes: z.array(SearchNodeSchema) }),
});

export type PullRequestNode = z.infer<typeof PullRequestNodeSchema>;
export type IssueNode = z.infer<typeof IssueNodeSchema>;
export type SearchNode = z.infer<typeof SearchNodeSchema>;

const ACTOR_FRAGMENT = `fragment Actor on Actor {
  __typename
  login
  avatarUrl(size: 64)
}`;

const ITEM_FIELDS = `
  number
  title
  url
  body
  createdAt
  updatedAt
  author { ...Actor }
  repository { nameWithOwner }
  assignees(first: 10) { nodes { login } }
  comments { totalCount }
  labels(first: 20) { nodes { name color } }
`;

const SEARCH_QUERY = `
query Search($query: String!) {
  search(type: ISSUE, query: $query, first: 50) {
    nodes {
      __typename
      ... on PullRequest {
        ${ITEM_FIELDS}
        isDraft
        reviewDecision
        mergeable
        reviewRequests(first: 10) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { ...Actor }
              ... on Bot { ...Actor }
            }
          }
        }
        latestReviews(first: 20) {
          nodes {
            author { ...Actor }
            state
            submittedAt
          }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup { state }
            }
          }
        }
      }
      ... on Issue {
        ${ITEM_FIELDS}
      }
    }
  }
}
${ACTOR_FRAGMENT}
`;

export interface SearchSpec {
  label: string;
  query: string;
}

export function buildSearches(
  owners: readonly string[],
  types: Record<string, "Organization" | "User">,
): SearchSpec[] {
  const searches: SearchSpec[] = [
    { label: "authored PRs", query: "is:pr is:open archived:false author:@me" },
    { label: "authored issues", query: "is:issue is:open archived:false author:@me" },
    {
      label: "review requests",
      query: "is:pr is:open archived:false user-review-requested:@me",
    },
    { label: "assigned PRs", query: "is:pr is:open archived:false assignee:@me -author:@me" },
    {
      label: "assigned issues",
      query: "is:issue is:open archived:false assignee:@me -author:@me",
    },
  ];

  owners.forEach(function (owner) {
    const scope = types[owner] === "Organization" ? "org" : "user";
    searches.push({
      label: `${owner} PRs`,
      query: `is:pr is:open archived:false -author:@me ${scope}:${owner}`,
    });
    searches.push({
      label: `${owner} issues`,
      query: `is:issue is:open archived:false -author:@me ${scope}:${owner}`,
    });
  });

  return searches;
}

export async function searchNodes(query: string): Promise<SearchNode[]> {
  const data = await graphql(SEARCH_QUERY, { query });
  return SearchDataSchema.parse(data).search.nodes;
}
