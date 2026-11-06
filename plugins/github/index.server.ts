import type { PluginServerContext } from "@getpaseo/plugin/server";

import {
  githubCollaborators,
  githubConfigRead,
  githubConfigWrite,
  githubList,
  githubRequestReview,
} from "./shared/github";
import { readConfig, writeConfig } from "./server/config";
import { listFeed } from "./server/feed";
import {
  collaborators,
  requestReview,
  viewerLogin,
} from "./server/gh";

export default function contribute(server: PluginServerContext) {
  server.handle(githubList, function (input) {
    return listFeed(input.force ?? false);
  });

  server.handle(githubConfigRead, async function () {
    return readConfig(await viewerLogin());
  });

  server.handle(githubConfigWrite, async function (input) {
    return writeConfig(input, await viewerLogin());
  });

  server.handle(githubCollaborators, async function (input) {
    return { users: await collaborators(input.repo) };
  });

  server.handle(githubRequestReview, async function (input) {
    await requestReview(input.repo, input.number, input.login);
    return { ok: true as const };
  });

  return function () {};
}
