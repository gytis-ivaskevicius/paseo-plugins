import type { usePaseo } from "@getpaseo/plugin/client";
import type { Item } from "../shared/github";

type Paseo = ReturnType<typeof usePaseo>;

export const SESSION_LABEL = "paseo-github";
export const ITEM_LABEL = "paseo-github-item";

export interface ProjectMatch {
  projectId: string;
  rootPath: string;
  repo: string;
}

export function githubRepoOf(projectKey: string | null | undefined): string | null {
  return /^remote:github\.com\/(.+)$/i.exec(projectKey ?? "")?.[1] ?? null;
}

export async function projectsByRepo(paseo: Paseo): Promise<ProjectMatch[]> {
  const { projects } = await paseo.projects.list();
  return projects.flatMap(function (project) {
    const repo = githubRepoOf(project.projectKey);
    return repo
      ? [{ repo, projectId: project.projectId, rootPath: project.projectRootPath }]
      : [];
  });
}

export async function existingSession(paseo: Paseo, itemKey: string): Promise<string | null> {
  const { entries } = await paseo.agents.list({
    filter: { labels: { [ITEM_LABEL]: itemKey } },
  });
  const agent = entries
    .map(function (entry) {
      return entry.agent;
    })
    .find(function (candidate) {
      return !candidate.archivedAt;
    });
  return agent?.id ?? null;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

async function agentConfig(paseo: Paseo): Promise<{
  provider: string;
  modeId?: string;
}> {
  const { config } = await paseo.config.get();
  const profiles = config.agentProfiles ?? [];
  const profile = profiles.find(function (candidate) {
    return candidate.id === "default";
  });

  if (profile?.model) {
    return {
      provider: `${profile.provider}/${profile.model}`,
      ...(profile.modeId ? { modeId: profile.modeId } : {}),
    };
  }

  const snapshot = await paseo.providers.snapshot();
  const ready = snapshot.entries.filter(function (entry) {
    return entry.status === "ready" && entry.enabled !== false;
  });
  const chosen =
    (profile
      ? ready.find(function (entry) {
          return entry.provider === profile.provider;
        })
      : undefined) ?? ready[0];
  if (!chosen) throw new Error("No agent provider is ready on this host.");

  const model =
    chosen.models?.find(function (candidate) {
      return candidate.isDefault;
    })?.id ?? chosen.models?.[0]?.id;
  if (!model) throw new Error("No model is available for the ready agent provider.");

  const modeId = profile?.modeId ?? chosen.defaultModeId ?? undefined;
  return {
    provider: `${chosen.provider}/${model}`,
    ...(modeId ? { modeId } : {}),
  };
}

export async function startSession(
  paseo: Paseo,
  item: Item,
  project: ProjectMatch,
): Promise<string> {
  const config = await agentConfig(paseo);
  const title = `${item.kind === "pull_request" ? "PR" : "Issue"} ${item.number}: ${item.title}`.slice(
    0,
    120,
  );

  const workspace = await paseo.workspaces.create({
    title,
    source:
      item.kind === "pull_request"
        ? {
            kind: "worktree",
            cwd: project.rootPath,
            projectId: project.projectId,
            action: "checkout",
            checkoutSource: { kind: "change_request", forge: "github", number: item.number },
          }
        : {
            kind: "worktree",
            cwd: project.rootPath,
            projectId: project.projectId,
            action: "branch-off",
            branchName: `issue-${item.number}-${slug(item.title)}`,
          },
  });

  const agent = await workspace.agents.create({
    config,
    title,
    prompt: `Work on ${item.key}: ${item.title}\n\n${item.url}`,
    labels: { [SESSION_LABEL]: "1", [ITEM_LABEL]: item.key },
  });
  return agent.id;
}
