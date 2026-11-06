import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ConfigSchema, sameLogin, type Config } from "../shared/github";
import { dataPath } from "./data-dir";

const OWNER_PATTERN = /^[A-Za-z0-9-]+$/;
const MAX_DEFAULT_ORGS = 10;

export function normalizeOwners(input: readonly string[], viewer: string): string[] {
  const owners: string[] = [];
  input.forEach(function (raw) {
    const owner = raw.trim();
    if (!owner) return;
    if (!OWNER_PATTERN.test(owner)) {
      throw new Error(`"${owner}" is not a GitHub login.`);
    }
    if (
      !owners.some(function (existing) {
        return sameLogin(existing, owner);
      })
    ) {
      owners.push(owner);
    }
  });

  if (owners.length === 0) throw new Error("Add at least one owner.");
  if (
    !owners.some(function (owner) {
      return sameLogin(owner, viewer);
    })
  ) {
    throw new Error(`Add your own login (${viewer}) to the owners.`);
  }
  return owners;
}

export function defaultConfig(viewer: string, orgs: readonly string[]): Config {
  // Each owner costs two searches per refresh and GitHub allows 30 search
  // requests per minute, so keep auto-detected defaults within that budget.
  return { owners: normalizeOwners([viewer, ...orgs.slice(0, MAX_DEFAULT_ORGS)], viewer) };
}

export function configPath(): string {
  return dataPath("config.json");
}

export interface ReadConfigOptions {
  path?: string;
  defaultOwners: () => Promise<readonly string[]>;
}

export async function readConfig(
  viewer: string,
  options: ReadConfigOptions,
): Promise<Config> {
  const path = options.path ?? configPath();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      let orgs: readonly string[] = [];
      try {
        orgs = await options.defaultOwners();
      } catch {
        // Organization membership is optional; fall back to the viewer alone.
      }
      return defaultConfig(viewer, orgs);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }

  const config = ConfigSchema.safeParse(parsed);
  if (!config.success) {
    throw new Error(`${path} must be an object with an "owners" array.`);
  }
  return { owners: normalizeOwners(config.data.owners, viewer) };
}

export async function writeConfig(
  input: Config,
  viewer: string,
  path = configPath(),
): Promise<Config> {
  const owners = normalizeOwners(input.owners, viewer);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ owners }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return { owners };
}
