import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type RepoToolName = "list_files" | "read_file" | "search_code" | "project_metadata";

export interface RepoTool<TInput, TOutput> {
  name: RepoToolName;
  description: string;
  input: (value: unknown) => TInput;
  execute: (root: string, input: TInput) => Promise<TOutput>;
}

const relativePath = (value: unknown): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > 200) {
    throw new Error("A valid repository-relative path is required.");
  }
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized) ||
      parts.some((part) => part === ".." || part === "" || part.startsWith(".") ||
        ["node_modules", ".git", ".next", "dist", "coverage"].includes(part))) {
    throw new Error("Path is outside the permitted repository.");
  }
  return normalized;
};

export function resolveRepoPath(root: string, relative: string): string {
  const full = path.resolve(root, relativePath(relative));
  const rel = path.relative(path.resolve(root), full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path is outside the permitted repository.");
  }
  return full;
}

async function safeExistingFile(root: string, relative: string): Promise<string> {
  const target = resolveRepoPath(root, relative);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Only regular files inside the repository are permitted.");
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(target)]);
  const rel = path.relative(canonicalRoot, canonicalTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Resolved file is outside the permitted repository.");
  return target;
}

const ignoredDirectories = new Set(["node_modules", ".git", ".next", "dist", "coverage"]);
const allowedFileExtensions = new Set([
  ".js", ".cjs", ".mjs", ".ts", ".tsx", ".jsx", ".json", ".md", ".yml", ".yaml", ".css"
]);

async function walk(root: string, relative = "", files: string[] = [], max = 200): Promise<string[]> {
  if (files.length >= max) return files;
  const entries = await readdir(path.resolve(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= max) break;
    if (entry.name.startsWith(".") || ignoredDirectories.has(entry.name)) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(root, child, files, max);
    } else if (entry.isFile() && allowedFileExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(child);
    }
  }
  return files;
}

export const repoTools: RepoTool<unknown, unknown>[] = [
  {
    name: "list_files",
    description: "List bounded source and documentation file paths, excluding hidden and dependency folders.",
    input: (value) => z.object({ limit: z.number().int().min(1).max(200).optional() }).strict()
      .transform((v) => ({ limit: v.limit ?? 80 })).parse(value),
    execute: async (root, value) => walk(root, "", [], (value as { limit: number }).limit)
  },
  {
    name: "read_file",
    description: "Read a permitted repository file, limited to 50 KB.",
    input: (value) => z.object({ path: z.string().min(1).max(200) }).strict()
      .transform(({ path: filePath }) => ({ path: relativePath(filePath) })).parse(value),
    execute: async (root, value) => {
      const filePath = (value as { path: string }).path;
      if (!allowedFileExtensions.has(path.extname(filePath).toLowerCase())) {
        throw new Error("File extension is not permitted for repository reading.");
      }
      const target = await safeExistingFile(root, filePath);
      const info = await stat(target);
      if (info.size > 50_000) throw new Error("File exceeds 50 KB.");
      return readFile(target, "utf8");
    }
  },
  {
    name: "search_code",
    description: "Search bounded repository text for a literal case-insensitive query.",
    input: (value) => z.object({ query: z.string().trim().min(2).max(100) }).strict()
      .transform(({ query }) => ({ query: query.toLowerCase() })).parse(value),
    execute: async (root, value) => {
      const query = (value as { query: string }).query;
      const files = await walk(root, "", [], 200);
      const results: Array<{ path: string; line: number; text: string }> = [];
      for (const file of files) {
        const full = resolveRepoPath(root, file);
        const info = await stat(full);
        if (info.size > 50_000) continue;
        const lines = (await readFile(full, "utf8")).split(/\r?\n/);
        lines.forEach((text, index) => {
          if (results.length < 40 && text.toLowerCase().includes(query)) {
            results.push({ path: file, line: index + 1, text: text.slice(0, 300) });
          }
        });
      }
      return results;
    }
  },
  {
    name: "project_metadata",
    description: "Read limited project metadata from package.json without running scripts.",
    input: (value) => z.object({}).strict().parse(value),
    execute: async (root) => {
      try {
        const packageJson = JSON.parse(await readFile(await safeExistingFile(root, "package.json"), "utf8"));
        return {
          name: String(packageJson.name ?? "unnamed").slice(0, 100),
          description: String(packageJson.description ?? "").slice(0, 300),
          scripts: Object.keys(packageJson.scripts ?? {}).slice(0, 20),
          dependencies: Object.keys(packageJson.dependencies ?? {}).slice(0, 30)
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { name: "unknown", scripts: [] };
        throw error;
      }
    }
  }
];

export function getRepoTool(name: RepoToolName): RepoTool<unknown, unknown> {
  const tool = repoTools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unregistered repository tool: ${name}`);
  return tool;
}

export const validatePatch = async (
  root: string,
  changes: Array<{ path: string; content: string }>
): Promise<string[]> => {
  if (changes.length < 1 || changes.length > 2) throw new Error("Patch must contain one or two files.");
  const seen = new Set<string>();
  for (const change of changes) {
    const rel = relativePath(change.path);
    if (!/^src\/[a-zA-Z0-9._/-]+\.js$/.test(rel) || rel.split("/").some((part) => part === ".")) {
      throw new Error(`Patch path is not allowed: ${rel}`);
    }
    if (seen.has(rel)) throw new Error(`Duplicate patch path: ${rel}`);
    seen.add(rel);
    const target = await safeExistingFile(root, rel);
    const info = await stat(target);
    if (info.size > 50_000) throw new Error(`Patch target is not permitted: ${rel}`);
    if (change.content.includes("\0")) throw new Error(`Patch contains invalid text: ${rel}`);
  }
  return [...seen];
};
