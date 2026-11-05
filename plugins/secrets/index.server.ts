import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getEntry, listEntries, removeEntry, setEntry } from "./server/secrets";
import {
  secretsGet,
  secretsList,
  secretsRemove,
  secretsSet,
} from "./shared/secrets";

export default function contribute(server: PluginServerContext) {
  server.handle(secretsList, listEntries);
  server.handle(secretsGet, getEntry);
  server.handle(secretsSet, setEntry);
  server.handle(secretsRemove, removeEntry);
  return () => {};
}
