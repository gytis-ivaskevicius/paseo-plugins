import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";

export const GitHubUserSchema = z.object({
  login: z.string(),
  avatarUrl: z.string().nullable(),
});

export const LabelSchema = z.object({
  name: z.string(),
  color: z.string(),
});

export const ReviewSchema = z.object({
  login: z.string(),
  avatarUrl: z.string().nullable(),
  state: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"]),
  submittedAt: z.string(),
});

export const BaseItemSchema = z.object({
  key: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string(),
  author: z.object({
    login: z.string(),
    avatarUrl: z.string().nullable(),
    isBot: z.boolean(),
  }),
  assignedToViewer: z.boolean(),
  labels: z.array(LabelSchema),
  commentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PullRequestItemSchema = BaseItemSchema.extend({
  kind: z.literal("pull_request"),
  isDraft: z.boolean(),
  reviewDecision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]).nullable(),
  mergeable: z.enum(["mergeable", "conflicting", "unknown"]),
  checks: z.enum(["passing", "failing", "pending", "none"]),
  requestedReviewers: z.array(GitHubUserSchema),
  reviews: z.array(ReviewSchema),
});

export const IssueItemSchema = BaseItemSchema.extend({
  kind: z.literal("issue"),
});

export const ItemSchema = z.discriminatedUnion("kind", [PullRequestItemSchema, IssueItemSchema]);

export const FeedSchema = z.object({
  viewer: z.string(),
  fetchedAt: z.string(),
  error: z.string().nullable(),
  groups: z.object({
    yourPrs: z.array(ItemSchema),
    incoming: z.array(ItemSchema),
    bots: z.array(ItemSchema),
    myIssues: z.array(ItemSchema),
  }),
});

export const ConfigSchema = z.object({
  owners: z.array(z.string()),
});

export const CollaboratorSchema = z.object({
  login: z.string(),
  avatarUrl: z.string().nullable(),
});

export type GitHubUser = z.infer<typeof GitHubUserSchema>;
export type Label = z.infer<typeof LabelSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type BaseItem = z.infer<typeof BaseItemSchema>;
export type PullRequestItem = z.infer<typeof PullRequestItemSchema>;
export type IssueItem = z.infer<typeof IssueItemSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Feed = z.infer<typeof FeedSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type Collaborator = z.infer<typeof CollaboratorSchema>;

export function sameLogin(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function sortItems<T extends { key: string; updatedAt: string }>(items: readonly T[]): T[] {
  return items.slice().sort(function (left, right) {
    const byUpdate = right.updatedAt.localeCompare(left.updatedAt);
    return byUpdate !== 0 ? byUpdate : left.key.localeCompare(right.key);
  });
}

export const githubList = defineRpc({
  name: "github.list",
  input: z.object({ force: z.boolean().optional() }),
  output: FeedSchema,
});

export const githubConfigRead = defineRpc({
  name: "github.config.read",
  input: z.object({}),
  output: ConfigSchema,
});

export const githubConfigWrite = defineRpc({
  name: "github.config.write",
  input: ConfigSchema,
  output: ConfigSchema,
});

export const githubCollaborators = defineRpc({
  name: "github.collaborators",
  input: z.object({ repo: z.string() }),
  output: z.object({ users: z.array(CollaboratorSchema) }),
});

export const githubRequestReview = defineRpc({
  name: "github.request-review",
  input: z.object({
    repo: z.string(),
    number: z.number().int().positive(),
    login: z.string(),
  }),
  output: z.object({ ok: z.literal(true) }),
});
