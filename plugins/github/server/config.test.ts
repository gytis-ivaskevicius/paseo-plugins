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

  it("defaults to the viewer plus the two owner organizations", async function () {
    const config = await readConfig("viewer", await tempPath());
    expect(config.owners).toEqual(["viewer", "vi-tality", "DevPalace"]);
  });

  it("round-trips a written config", async function () {
    const path = await tempPath();
    const written = await writeConfig({ owners: ["viewer", "vi-tality"] }, "viewer", path);
    expect(written.owners).toEqual(["viewer", "vi-tality"]);
    expect(await readConfig("viewer", path)).toEqual(written);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(written);
  });

  it("reports malformed JSON with the path", async function () {
    const path = await tempPath();
    await writeConfig({ owners: ["viewer"] }, "viewer", path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "not json", "utf8");
    await expect(readConfig("viewer", path)).rejects.toThrow(`${path} is not valid JSON.`);
  });
});
