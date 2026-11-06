import { spawn } from "node:child_process";

const SETUP_MARKER = "GITHUB_SETUP:";

export class GhSetupError extends Error {
  constructor(message: string) {
    super(`${SETUP_MARKER} ${message}`);
    this.name = "GhSetupError";
  }
}

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runGh(args: string[], input?: string): Promise<GhResult> {
  return new Promise(function (resolve, reject) {
    const child = spawn("gh", args, { env: process.env });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("GitHub did not answer within two minutes."));
    }, 120_000);

    child.stdout.on("data", function (chunk: Buffer) {
      stdout += chunk.toString();
    });
    child.stderr.on("data", function (chunk: Buffer) {
      stderr += chunk.toString();
    });
    child.stdin.on("error", function () {});
    child.on("error", function (error: NodeJS.ErrnoException) {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(
        error.code === "ENOENT"
          ? new GhSetupError(
              "The GitHub CLI (gh) isn't on the daemon's PATH. Install it and run `gh auth login`.",
            )
          : error,
      );
    });
    child.on("close", function (code) {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 1, stdout, stderr });
    });

    child.stdin.end(input ?? "");
  });
}

function isAuthFailure(text: string): boolean {
  return /auth login|not logged|authentication|HTTP 401|Bad credentials|GH_TOKEN|To use GitHub CLI/i.test(
    text,
  );
}

function setupHint(stderr: string, code: number): string {
  const text = stderr.trim();
  if (isAuthFailure(text)) return "Run `gh auth login` on the daemon host, then refresh.";
  return text || `gh exited with ${code}`;
}

function ghFailure(stderr: string, code: number): Error {
  const text = stderr.trim();
  if (isAuthFailure(text)) return new GhSetupError(setupHint(stderr, code));
  return new Error(text || `gh exited with ${code}`);
}

export async function viewerLogin(): Promise<string> {
  const result = await runGh(["api", "user", "--jq", ".login"]);
  if (result.code !== 0) throw ghFailure(result.stderr, result.code);
  const login = result.stdout.trim();
  if (!login) throw new GhSetupError("Run `gh auth login` on the daemon host, then refresh.");
  return login;
}

export async function viewerOrgs(): Promise<string[]> {
  const result = await runGh(["api", "user/orgs", "--paginate", "--jq", ".[].login"]);
  if (result.code !== 0) throw ghFailure(result.stderr, result.code);
  return result.stdout
    .split("\n")
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean);
}

export async function graphql(
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const result = await runGh(
    ["api", "graphql", "--input", "-"],
    JSON.stringify({ query, variables }),
  );
  if (result.code !== 0) {
    throw ghFailure(result.stderr, result.code);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("GitHub returned a response that wasn't JSON.");
  }

  const body = parsed as {
    data?: unknown;
    errors?: Array<{ message?: string }>;
  };
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const message = body.errors
      .map(function (error) {
        return error.message;
      })
      .filter(Boolean)
      .join("; ");
    throw new Error(message || "GitHub rejected the request.");
  }
  if (body.data === undefined || body.data === null) {
    throw new Error("GitHub returned no data.");
  }
  return body.data;
}

const OWNER_PATTERN = /^[A-Za-z0-9-]+$/;

export async function ownerType(owner: string): Promise<"Organization" | "User"> {
  if (!OWNER_PATTERN.test(owner)) throw new Error(`"${owner}" is not a GitHub login.`);
  const result = await runGh(["api", `users/${owner}`, "--jq", ".type"]);
  if (result.code !== 0) throw ghFailure(result.stderr, result.code);
  return result.stdout.trim() === "Organization" ? "Organization" : "User";
}

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const LOGIN_PATTERN = /^[A-Za-z0-9-]+$/;

export function validateRepo(repo: string): void {
  if (!REPO_PATTERN.test(repo)) throw new Error(`"${repo}" is not a GitHub repository.`);
  const segments = repo.split("/");
  if (segments.some(function (segment) {
    return segment === "." || segment === "..";
  })) {
    throw new Error(`"${repo}" is not a GitHub repository.`);
  }
}

export function validateLogin(login: string): void {
  if (!LOGIN_PATTERN.test(login)) throw new Error(`"${login}" is not a GitHub login.`);
}

export interface Collaborator {
  login: string;
  avatarUrl: string | null;
}

export async function collaborators(repo: string): Promise<Collaborator[]> {
  validateRepo(repo);
  const result = await runGh(["api", `repos/${repo}/collaborators?per_page=100`]);
  if (result.code !== 0) {
    throw ghFailure(result.stderr, result.code);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("GitHub returned a collaborator list that wasn't JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("GitHub returned an unexpected collaborator response.");
  }

  return parsed
    .map(function (entry) {
      const user = entry as { login?: unknown; avatar_url?: unknown };
      return typeof user.login === "string"
        ? {
            login: user.login,
            avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
          }
        : null;
    })
    .filter(function (user): user is Collaborator {
      return user !== null;
    });
}

export async function requestReview(
  repo: string,
  number: number,
  login: string,
): Promise<void> {
  validateRepo(repo);
  validateLogin(login);
  const result = await runGh(
    [
      "api",
      "--method",
      "POST",
      `repos/${repo}/pulls/${number}/requested_reviewers`,
      "--input",
      "-",
    ],
    JSON.stringify({ reviewers: [login] }),
  );
  if (result.code !== 0) {
    throw ghFailure(result.stderr, result.code);
  }
}
