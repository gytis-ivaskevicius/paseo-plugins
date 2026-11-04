/**
 * Where this plugin keeps its own files: `$PASEO_HOME/plugin-data/paseo-cron/`.
 *
 * Paseo installs a plugin into `$PASEO_HOME/plugins/<id>/` and deletes that
 * directory whole on `paseo plugin remove`. It never touches `plugin-data/`,
 * so the job store, the logs and the run history live here and survive a
 * reinstall.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export const PLUGIN_ID = "paseo-cron";

export function paseoHome(): string {
  return process.env.PASEO_HOME ?? join(homedir(), ".paseo");
}

export function pluginDir(): string {
  return join(paseoHome(), "plugin-data", PLUGIN_ID);
}

/** One of the plugin's own files, by path relative to its directory. */
export function dataPath(entry: string): string {
  return join(pluginDir(), entry);
}
