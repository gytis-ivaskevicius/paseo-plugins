import { homedir } from "node:os";
import { join } from "node:path";

export const PLUGIN_ID = "paseo-github";

export function paseoHome(): string {
  return process.env.PASEO_HOME ?? join(homedir(), ".paseo");
}

export function pluginDir(): string {
  return join(paseoHome(), "plugin-data", PLUGIN_ID);
}

export function dataPath(entry: string): string {
  return join(pluginDir(), entry);
}
