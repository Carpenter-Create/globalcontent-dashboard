import { z } from "zod";

/** Full Git object SHA (40 lowercase hex). */
export const gitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "base_sha must be 40 lowercase hex characters");

export const sha256DigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "digest must be sha256: + 64 lowercase hex");

export const agentBindingSchema = z.strictObject({
  agent: z.enum(["cursor", "codex", "claude_code", "human", "other"]),
});

export const sourceRefSchema = z.strictObject({
  path: z.string().min(1),
  sections: z.array(z.string().min(1)).optional(),
});

export const baselineExceptionSchema = z.strictObject({
  check_name: z.string().min(1),
  failing_step: z.string().min(1),
  fingerprint: z.string().min(1),
  note: z.string().min(1).optional(),
});

export const acceptanceCriterionSchema = z.strictObject({
  id: z.string().min(1),
  description: z.string().min(1),
});

/**
 * Authorized task contract (spec §6.5).
 * Unknown keys rejected (.strict). Execution-permission booleans are not fields.
 */
export const taskContractSchema = z
  .strictObject({
    schema_version: z.literal(1),
    task_id: z
      .string()
      .regex(/^AE-[0-9]{4,}$/, "task_id must match AE-#### (+)"),
    contract_version: z.number().int().positive(),
    title: z.string().min(1),
    authorized_scope: z.array(z.string().min(1)).min(1),
    out_of_scope: z.array(z.string().min(1)),
    source_refs: z.array(sourceRefSchema).min(1),
    base_branch: z.string().min(1),
    base_sha: gitShaSchema,
    work_branch: z.string().min(1),
    role_separation: z.literal("required"),
    implementer: agentBindingSchema,
    reviewer: agentBindingSchema,
    validation_additions: z.strictObject({
      commands: z.array(z.string().min(1)),
      status_checks: z.array(z.string().min(1)),
    }),
    baseline_exceptions: z.array(baselineExceptionSchema),
    may_draft_migration_sql: z.boolean(),
    may_draft_production_runbook: z.boolean(),
    dependency_addition_allowed: z.boolean(),
    ci_workflow_change_allowed: z.boolean(),
    review_intensity: z.enum(["strict", "single_pass"]),
    max_remediation_rounds: z.number().int().min(1).max(50),
    acceptance_criteria: z.array(acceptanceCriterionSchema).min(1),
  });

export type TaskContract = z.infer<typeof taskContractSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type BaselineException = z.infer<typeof baselineExceptionSchema>;
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;

/** Keys that must never appear on a contract object (execution authority). */
export const FORBIDDEN_CONTRACT_KEYS = [
  "production_mutation_allowed",
  "destructive_ops_allowed",
] as const;

export function parseTaskContract(input: unknown): TaskContract {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const key of FORBIDDEN_CONTRACT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        throw new Error(`forbidden contract field: ${key}`);
      }
    }
  }
  return taskContractSchema.parse(input);
}

export function safeParseTaskContract(input: unknown) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const key of FORBIDDEN_CONTRACT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        return {
          success: false as const,
          error: {
            issues: [
              {
                code: "custom" as const,
                path: [key],
                message: `forbidden contract field: ${key}`,
              },
            ],
          },
        };
      }
    }
  }
  return taskContractSchema.safeParse(input);
}
