import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ConfigSchema, sameLogin, type Config } from "../shared/github";
import { dataPath } from "./data-dir";

export const DEFAULT_OWNERS = ["vi-tality", "DevPalace"];
const OWNER_PATTERN = /^[A-Za-z0-9-]+$/;

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

export function defaultConfig(viewer: string): Config {
  return { owners: normalizeOwners([viewer, ...DEFAULT_OWNERS], viewer) };
}

export function configPath(): string {
  return dataPath("config.json");
}

export async function readConfig(viewer: string, path = configPath()): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultConfig(viewer);
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
