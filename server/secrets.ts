import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import {
  entryNameError,
  nameError,
  secretsGet,
  secretsList,
  secretsRemove,
  secretsSet,
  valueError,
} from "../shared/secrets";

function storeRoot(): string {
  return process.env.PASSWORD_STORE_DIR ?? path.join(homedir(), ".password-store");
}

function entryPath(name: string): string {
  return path.join(storeRoot(), `${name}.gpg`);
}

async function executable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolvePass(): Promise<string> {
  const candidates: string[] = [];
  if (process.env.PASS_BIN) candidates.push(process.env.PASS_BIN);
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, "pass"));
  }
  candidates.push("/home/celty/.nix-profile/bin/pass");
  for (const candidate of candidates) {
    if (await executable(candidate)) return candidate;
  }
  throw new Error("PASS_NOT_FOUND: pass was not found. Set PASS_BIN or put pass on PATH.");
}

function checkedName(name: string): void {
  const problem = nameError(name);
  if (problem) throw new Error(`INVALID_NAME: ${problem}`);
}

function checkedEntryName(name: string): void {
  const problem = entryNameError(name);
  if (problem) throw new Error(`INVALID_NAME: ${problem}`);
}

async function exists(name: string): Promise<boolean> {
  try {
    await access(entryPath(name), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

interface PassResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runPass(args: string[], input = ""): Promise<PassResult> {
  const bin = await resolvePass();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      reject(new Error(`PASS_NOT_FOUND: Could not run pass: ${error.message}`));
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

interface Entry {
  name: string;
  updatedAt: number;
  bytes: number;
}

async function walk(root: string, dir: string): Promise<Entry[]> {
  const found: Entry[] = [];
  for (const dirent of await readdir(dir, { withFileTypes: true })) {
    if (dirent.name.startsWith(".")) continue;
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      found.push(...(await walk(root, full)));
    } else if (dirent.isFile() && dirent.name.endsWith(".gpg")) {
      const info = await stat(full);
      found.push({
        name: path.relative(root, full).slice(0, -4).split(path.sep).join("/"),
        updatedAt: info.mtimeMs,
        bytes: info.size,
      });
    }
  }
  return found;
}

export async function listEntries({ query }: RpcInput<typeof secretsList>) {
  const root = storeRoot();
  try {
    await access(root, constants.R_OK);
  } catch {
    throw new Error(
      `STORE_NOT_FOUND: Password store not found at ${root}. Set PASSWORD_STORE_DIR or create the store.`,
    );
  }
  await resolvePass();
  const entries = await walk(root, root);
  const wanted = query?.toLowerCase() ?? "";
  return {
    entries: entries
      .filter((entry) => entry.name.toLowerCase().includes(wanted))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function getEntry({
  name,
}: RpcInput<typeof secretsGet>) {
  checkedEntryName(name);
  const result = await runPass(["show", name]);
  if (result.code === 1) throw new Error(`NOT_FOUND: No entry named ${name}.`);
  if (result.code !== 0) {
    throw new Error(`PASS_FAILED: ${result.stderr.trim() || `pass show exited ${result.code}`}`);
  }
  const newline = result.stdout.indexOf("\n");
  return {
    name,
    value: newline === -1 ? result.stdout : result.stdout.slice(0, newline),
    notes: newline === -1 ? "" : result.stdout.slice(newline + 1),
  };
}

export async function setEntry({
  name,
  value,
  notes,
  overwrite,
}: RpcInput<typeof secretsSet>) {
  checkedName(name);
  const problem = valueError(value);
  if (problem) {
    throw new Error(`${value === "" ? "EMPTY_VALUE" : "INVALID_VALUE"}: ${problem}`);
  }
  if (!overwrite && (await exists(name))) {
    throw new Error(`EXISTS: ${name} already exists.`);
  }
  const input = notes ? `${value}\n${notes}` : value;
  const result = await runPass(["insert", "-m", "-f", name], input);
  if (result.code !== 0) {
    throw new Error(`PASS_FAILED: ${result.stderr.trim() || `pass insert exited ${result.code}`}`);
  }
  return { name };
}

export async function removeEntry({
  name,
}: RpcInput<typeof secretsRemove>) {
  checkedEntryName(name);
  const result = await runPass(["rm", "-f", name]);
  if (result.code !== 0) {
    throw new Error(`PASS_FAILED: ${result.stderr.trim() || `pass rm exited ${result.code}`}`);
  }
  return { name };
}
