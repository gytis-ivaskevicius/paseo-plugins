import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeOwners, readConfig, writeConfig } from "./config";

const roots: string[] = [];

async function tempPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "paseo-github-"));
  roots.push(root);
  return join(root, "nested", "config.json");
}

afterEach(async function () {
  await Promise.all(
    roots.splice(0).map(function (root) {
      return rm(root, { recursive: true, force: true });
    }),
  );
});

describe("config", function () {
  it("rejects an empty owner list", function () {
    expect(function () {
      normalizeOwners([], "viewer");
    }).toThrow("Add at least one owner.");
  });

  it("rejects a list that omits the viewer", function () {
    expect(function () {
      normalizeOwners(["vi-tality"], "viewer");
    }).toThrow("Add your own login (viewer) to the owners.");
  });

  it("deduplicates owners case-insensitively", function () {
    expect(normalizeOwners(["Viewer", "viewer", "vi-tality"], "viewer")).toEqual([
      "Viewer",
      "vi-tality",
    ]);
  });

  it("defaults to the viewer plus the viewer's organizations", async function () {
    const config = await readConfig("viewer", {
      defaultOwners: async function () {
        return ["acme", "widgets"];
      },
      path: await tempPath(),
    });
    expect(config.owners).toEqual(["viewer", "acme", "widgets"]);
  });

  it("caps auto-detected organizations at the search budget", async function () {
    const orgs = Array.from({ length: 12 }, function (_, index) {
      return `org-${index}`;
    });
    const config = await readConfig("viewer", {
      defaultOwners: async function () {
        return orgs;
      },
      path: await tempPath(),
    });
    expect(config.owners).toEqual(["viewer", ...orgs.slice(0, 10)]);
  });

  it("falls back to the viewer when organizations cannot be read", async function () {
    const config = await readConfig("viewer", {
      defaultOwners: async function () {
        throw new Error("missing read:org scope");
      },
      path: await tempPath(),
    });
    expect(config.owners).toEqual(["viewer"]);
  });

  it("does not fetch organizations when a config already exists", async function () {
    const path = await tempPath();
    await writeConfig({ owners: ["viewer", "acme"] }, "viewer", path);
    const config = await readConfig("viewer", {
      defaultOwners: async function () {
        throw new Error("should not be called");
      },
      path,
    });
    expect(config.owners).toEqual(["viewer", "acme"]);
  });

  it("round-trips a written config", async function () {
    const path = await tempPath();
    const written = await writeConfig({ owners: ["viewer", "vi-tality"] }, "viewer", path);
    expect(written.owners).toEqual(["viewer", "vi-tality"]);
    expect(await readConfig("viewer", { defaultOwners: async () => [], path })).toEqual(written);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(written);
  });

  it("reports malformed JSON with the path", async function () {
    const path = await tempPath();
    await writeConfig({ owners: ["viewer"] }, "viewer", path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "not json", "utf8");
    await expect(
      readConfig("viewer", { defaultOwners: async () => [], path }),
    ).rejects.toThrow(`${path} is not valid JSON.`);
  });
});
