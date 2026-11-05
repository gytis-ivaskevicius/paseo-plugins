import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readdir, stat } from "node:fs/promises";
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

async function assertStore(): Promise<string> {
  const root = storeRoot();
  try {
    await access(root, constants.R_OK);
  } catch {
    throw new Error(
      `STORE_NOT_FOUND: Password store not found at ${root}. Set PASSWORD_STORE_DIR or create the store.`,
    );
  }
  return root;
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
  candidates.push(path.join(homedir(), ".nix-profile", "bin", "pass"));
  for (const candidate of candidates) {
    if (await executable(candidate)) return candidate;
  }
  throw new Error("PASS_NOT_FOUND: pass was not found. Set PASS_BIN or put pass on PATH.");
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

const writeQueues = new Map<string, Promise<void>>();

async function withWriteLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(name) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  writeQueues.set(name, queued);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (writeQueues.get(name) === queued) writeQueues.delete(name);
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

async function walk(root: string, dir: string, isRoot = false): Promise<Entry[]> {
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (!isRoot && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const found: Entry[] = [];
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) continue;
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      found.push(...(await walk(root, full)));
    } else if (dirent.isFile() && dirent.name.endsWith(".gpg")) {
      try {
        const info = await stat(full);
        found.push({
          name: path.relative(root, full).slice(0, -4).split(path.sep).join("/"),
          updatedAt: info.mtimeMs,
          bytes: info.size,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }
  }
  return found;
}

export async function listEntries({ query }: RpcInput<typeof secretsList>) {
  const root = await assertStore();
  await resolvePass();
  let entries: Entry[];
  try {
    entries = await walk(root, root, true);
  } catch (error) {
    throw new Error(
      `STORE_READ_FAILED: Could not read the password store at ${root}: ${(error as Error).message}`,
    );
  }
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
  const relaxed = entryNameError(name);
  if (relaxed) throw new Error(`INVALID_NAME: ${relaxed}`);
  const problem = valueError(value);
  if (problem) {
    throw new Error(`${value === "" ? "EMPTY_VALUE" : "INVALID_VALUE"}: ${problem}`);
  }
  await assertStore();
  return withWriteLock(name, async () => {
    const strict = nameError(name);
    if (strict && !(overwrite && (await exists(name)))) {
      throw new Error(`INVALID_NAME: ${strict}`);
    }
    if (!overwrite && (await exists(name))) {
      throw new Error(`EXISTS: ${name} already exists.`);
    }
    await mkdir(path.dirname(entryPath(name)), { recursive: true, mode: 0o700 });
    const input = notes ? `${value}\n${notes}` : value;
    const result = await runPass(["insert", "-m", "-f", name], input);
    if (result.code !== 0) {
      throw new Error(`PASS_FAILED: ${result.stderr.trim() || `pass insert exited ${result.code}`}`);
    }
    return { name };
  });
}

export async function removeEntry({
  name,
}: RpcInput<typeof secretsRemove>) {
  checkedEntryName(name);
  return withWriteLock(name, async () => {
    const result = await runPass(["rm", "-f", name]);
    if (result.code !== 0) {
      throw new Error(`PASS_FAILED: ${result.stderr.trim() || `pass rm exited ${result.code}`}`);
    }
    return { name };
  });
}
