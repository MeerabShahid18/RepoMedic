import { z } from "zod";

export const runRequestSchema = z.object({
  repositoryId: z.literal("demo-express"),
  bugReport: z.string().trim().min(12).max(2000),
  mode: z.enum(["ollama", "demo"]).default("ollama")
});

export const proposedChangeSchema = z.object({
  path: z.string().min(1).max(160),
  content: z.string().max(50_000)
});

export const modelResultSchema = z.object({
  summary: z.string().min(1).max(700),
  rootCause: z.string().min(1).max(1400),
  confidence: z.number().min(0).max(1),
  references: z.array(z.object({
    path: z.string().min(1).max(160),
    reason: z.string().min(1).max(400)
  })).max(6),
  changes: z.array(proposedChangeSchema).min(1).max(2),
  regressionTest: z.string().max(5000).default("")
});

export type ModelResult = z.infer<typeof modelResultSchema>;
export type RunRequest = z.infer<typeof runRequestSchema>;

export const runStates = [
  "CREATED",
  "ANALYZING",
  "INVESTIGATING",
  "DIAGNOSING",
  "PATCH_PROPOSED",
  "TESTING",
  "VERIFIED",
  "FAILED",
  "NEEDS_REVIEW"
] as const;
export type RunState = typeof runStates[number];
