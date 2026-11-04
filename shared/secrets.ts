import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const SEGMENT = /^[A-Za-z0-9._@+-]+$/;

function segmentsError(name: string): string | null {
  if (name === "") return "Enter a name.";
  if (name.startsWith("/")) return "The name cannot start with /.";
  if (name.endsWith("/")) return "The name cannot end with /.";
  if (name.toLowerCase().endsWith(".gpg")) return "The name cannot end in .gpg.";
  if (name.startsWith("-")) return "The name cannot start with -.";
  for (const segment of name.split("/")) {
    if (segment === "") return "The name cannot contain an empty path segment.";
    if (segment === "." || segment === "..") return `The name cannot contain a "${segment}" path segment.`;
  }
  return null;
}

export function valueError(value: string): string | null {
  if (value === "") return "Enter a value.";
  if (value.includes("\n") || value.includes("\r")) return "The value must be a single line.";
  return null;
}

export function nameError(name: string): string | null {
  const problem = segmentsError(name);
  if (problem) return problem;
  for (const segment of name.split("/")) {
    if (segment.startsWith(".")) return `"${segment}" cannot start with a dot.`;
    if (!SEGMENT.test(segment)) return `"${segment}" can only use letters, numbers, . _ @ + and -.`;
  }
  return null;
}

export function entryNameError(name: string): string | null {
  return segmentsError(name);
}

export const secretsList = defineRpc({
  name: "secrets.list",
  input: z.object({ query: z.string().optional() }),
  output: z.object({
    entries: z.array(
      z.object({
        name: z.string(),
        updatedAt: z.number(),
        bytes: z.number(),
      }),
    ),
  }),
});

export const secretsGet = defineRpc({
  name: "secrets.get",
  input: z.object({ name: z.string() }),
  output: z.object({ name: z.string(), value: z.string(), notes: z.string() }),
});

export const secretsSet = defineRpc({
  name: "secrets.set",
  input: z.object({
    name: z.string(),
    value: z.string(),
    notes: z.string().optional(),
    overwrite: z.boolean().optional(),
  }),
  output: z.object({ name: z.string() }),
});

export const secretsRemove = defineRpc({
  name: "secrets.remove",
  input: z.object({ name: z.string() }),
  output: z.object({ name: z.string() }),
});
