import type { Operation } from "../planner/types.js";

export type ExecutionStepStatus = "SUCCESS" | "FAILED" | "SKIPPED";

export interface ExecutionStep {
  operation: Operation;
  status: ExecutionStepStatus;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface ExecutionResult {
  success: boolean;
  totalOperations: number;
  completed: ExecutionStep[];
  failed?: ExecutionStep;
  unexecuted: Operation[];
}

export interface ExecutorOptions {
  interactive?: boolean;
  allowDestructive?: boolean;
  autoApprove?: boolean;
  dryRun?: boolean;
  auditReason?: string;
}
