import { z } from "zod";
import { InputError } from "../domain/security.js";
export const targetSchema = z
  .object({
    kind: z.enum(["role", "label", "testId"]),
    value: z.string().max(200),
    role: z
      .enum([
        "button",
        "link",
        "heading",
        "textbox",
        "checkbox",
        "combobox",
        "alert",
        "status",
        "navigation",
      ])
      .nullable(),
  })
  .strict();
export const stepSchema = z
  .object({
    op: z.enum([
      "navigate",
      "click",
      "fill",
      "select",
      "check",
      "uncheck",
      "reload",
      "assertVisible",
      "assertAbsent",
      "assertText",
      "assertValue",
      "assertURL",
      "assertEnabled",
      "assertDisabled",
    ]),
    target: targetSchema.nullable(),
    value: z.string().max(4000).nullable(),
    path: z.string().max(1000).nullable(),
  })
  .strict();
export const caseSchema = z
  .object({
    title: z.string().min(3).max(180),
    module: z.string().min(1).max(80),
    priority: z.enum(["critical", "high", "normal"]),
    roleRef: z.string().max(80).nullable(),
    requirementIds: z.array(z.string().uuid()).min(1).max(20),
    preconditions: z.string().max(1000),
    steps: z.array(stepSchema).min(1).max(50),
    cleanup: z.array(stepSchema).max(20),
    retrySafe: z.boolean(),
  })
  .strict();
export const generationSchema = z
  .object({
    cases: z.array(caseSchema).min(1).max(10),
    questions: z.array(z.string().max(600)).max(10),
  })
  .strict();
export type TestCase = z.infer<typeof caseSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Target = z.infer<typeof targetSchema>;
export function validateCase(input: unknown): TestCase {
  const c = caseSchema.parse(input);
  if (!c.steps.some((s) => s.op.startsWith("assert")))
    throw Error("A case needs at least one explicit assertion");
  for (const s of [...c.steps, ...c.cleanup]) {
    if (s.op === "navigate") {
      if (
        !s.path?.startsWith("/") ||
        s.path.startsWith("//") ||
        s.path.includes("\\")
      )
        throw Error("Navigation must use a relative application path");
    } else if (!["reload", "assertURL"].includes(s.op) && !s.target)
      throw Error(`${s.op} requires a target`);
    if (
      ["fill", "select", "assertText", "assertValue", "assertURL"].includes(
        s.op,
      ) &&
      s.value === null
    )
      throw Error(`${s.op} requires a value`);
    if (s.target?.kind === "role" && !s.target.role)
      throw Error("Role locator requires a role");
  }
  return c;
}
export function verdict(outcomes: string[], complete: boolean, buildOK = true) {
  if (
    !complete ||
    !buildOK ||
    !outcomes.length ||
    outcomes.some((v) => !["passed", "failed"].includes(v))
  )
    return "inconclusive";
  return outcomes.includes("failed") ? "failed" : "passed";
}
export const plans = {
  starter: {
    projects: 2,
    schedules: 2,
    browserMinutes: 120,
    aiRequests: 20,
    storageBytes: 1024 ** 3,
  },
  studio: {
    projects: 10,
    schedules: 20,
    browserMinutes: 1000,
    aiRequests: 100,
    storageBytes: 5 * 1024 ** 3,
  },
} as const;
export const roles = ["owner", "maintainer", "viewer"] as const;
