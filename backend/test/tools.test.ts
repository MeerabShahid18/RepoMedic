import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canTransition } from "../src/harness";
import { modelResultSchema, runRequestSchema } from "../src/schemas";
import { getRepoTool, resolveRepoPath, validatePatch } from "../src/tools";

const demoRoot = path.resolve(__dirname, "../../demo-repo");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository tool safety", () => {
  it("rejects path traversal and absolute paths", () => {
    expect(() => resolveRepoPath(demoRoot, "../outside.txt")).toThrow();
    expect(() => resolveRepoPath(demoRoot, "C:\\outside.txt")).toThrow();
  });

  it("validates tool inputs and reads only bounded files", async () => {
    const readFileTool = getRepoTool("read_file");
    expect(() => readFileTool.input({ path: "../package.json" })).toThrow();
    const content = await readFileTool.execute(demoRoot, readFileTool.input({ path: "src/users.js" }));
    expect(content).toContain("function findUser");
    const fileList = await getRepoTool("list_files").execute(demoRoot, { limit: 200 }) as string[];
    expect(fileList).toContain("test/users.test.js");
    expect(fileList).not.toContain("node_modules");
  });

  it("rejects symlinks that resolve outside the registered repository", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "repomedic-tools-"));
    temporaryRoots.push(parent);
    const root = path.join(parent, "repo");
    const outside = path.join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "not repository data");
    await writeFile(path.join(outside, "secret.js"), "not repository code");
    await symlink(outside, path.join(root, "src"), "junction");
    await expect(getRepoTool("read_file").execute(root, { path: "src/secret.txt" })).rejects.toThrow();
    await expect(validatePatch(root, [{ path: "src/secret.js", content: "x" }])).rejects.toThrow();
  });

  it("allows only src JavaScript replacement patches", async () => {
    await expect(validatePatch(demoRoot, [{ path: "src/users.js", content: "module.exports = {};" }]))
      .resolves.toEqual(["src/users.js"]);
    await expect(validatePatch(demoRoot, [{ path: "test/users.test.js", content: "" }])).rejects.toThrow();
    await expect(validatePatch(demoRoot, [{ path: "src/../../outside.js", content: "" }])).rejects.toThrow();
  });
});

describe("request and model output schemas", () => {
  it("requires a selected registered repository and bounded issue text", () => {
    expect(runRequestSchema.safeParse({
      repositoryId: "demo-express",
      bugReport: "A reproducible bug report",
      mode: "demo"
    }).success).toBe(true);
    expect(runRequestSchema.safeParse({
      repositoryId: "arbitrary-path",
      bugReport: "A reproducible bug report",
      mode: "ollama"
    }).success).toBe(false);
  });

  it("rejects model output that lacks evidence or an allowed change shape", () => {
    expect(modelResultSchema.safeParse({
      summary: "A bug",
      rootCause: "An indexing issue",
      confidence: 0.8,
      references: [],
      changes: [{ path: "../../package.json", content: "bad" }]
    }).success).toBe(true);
    expect(modelResultSchema.safeParse({ summary: "incomplete" }).success).toBe(false);
  });
});

describe("harness workflow state machine", () => {
  it("allows only the defined forward transitions", () => {
    expect(canTransition("CREATED", "ANALYZING")).toBe(true);
    expect(canTransition("PATCH_PROPOSED", "TESTING")).toBe(true);
    expect(canTransition("PATCH_PROPOSED", "VERIFIED")).toBe(false);
    expect(canTransition("VERIFIED", "TESTING")).toBe(false);
  });
});
