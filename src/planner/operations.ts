import type { Operation, OperationType, PlanSummary } from "./types.js";

const OPERATION_PRIORITY: Record<OperationType, number> = {
  CREATE_ROLE: 10,
  UPDATE_ROLE: 20,
  CREATE_EMOJI: 25,
  UPDATE_EMOJI: 26,
  CREATE_CATEGORY: 30,
  UPDATE_CATEGORY: 40,
  CREATE_CHANNEL: 50,
  UPDATE_CHANNEL: 60,
  MOVE_CHANNEL: 65,
  SET_PERMISSIONS: 70,
  DELETE_PERMISSIONS: 75,
  REORDER_CATEGORIES: 80,
  REORDER_CHANNELS: 85,
  REORDER_ROLES: 90,
  DELETE_EMOJI: 95,
  DELETE_CHANNEL: 100,
  DELETE_CATEGORY: 110,
  DELETE_ROLE: 120,
};

/**
 * Sort operations using a combination of operation type priority and dependency graph.
 */
export function sortOperations(operations: Operation[]): Operation[] {
  // Map ID to operation
  const opMap = new Map<string, Operation>();
  for (const op of operations) {
    opMap.set(op.id, op);
  }

  // Pre-sort by operation type priority and deterministic resource name
  const sorted = [...operations].sort((a, b) => {
    const prioA = OPERATION_PRIORITY[a.type] ?? 50;
    const prioB = OPERATION_PRIORITY[b.type] ?? 50;
    if (prioA !== prioB) return prioA - prioB;
    return a.resourceName.localeCompare(b.resourceName);
  });

  // Topological sort to ensure dependsOn comes before dependent
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: Operation[] = [];

  function visit(opId: string) {
    if (visited.has(opId)) return;
    if (visiting.has(opId)) {
      // Circular dependency fallback: ignore cycle to prevent infinite loop
      return;
    }
    visiting.add(opId);

    const op = opMap.get(opId);
    if (op) {
      for (const depId of op.dependsOn) {
        if (opMap.has(depId)) {
          visit(depId);
        }
      }
      visited.add(opId);
      result.push(op);
    }
    visiting.delete(opId);
  }

  for (const op of sorted) {
    visit(op.id);
  }

  return result;
}

/**
 * Calculate count summaries for an operation list.
 */
export function calculatePlanSummary(operations: Operation[]): PlanSummary {
  let create = 0;
  let update = 0;
  let del = 0;
  let destructive = 0;

  for (const op of operations) {
    if (op.isDestructive) {
      destructive++;
    }

    if (
      op.type === "CREATE_ROLE" ||
      op.type === "CREATE_EMOJI" ||
      op.type === "CREATE_CATEGORY" ||
      op.type === "CREATE_CHANNEL"
    ) {
      create++;
    } else if (
      op.type === "DELETE_ROLE" ||
      op.type === "DELETE_EMOJI" ||
      op.type === "DELETE_CATEGORY" ||
      op.type === "DELETE_CHANNEL" ||
      op.type === "DELETE_PERMISSIONS"
    ) {
      del++;
    } else {
      update++;
    }
  }

  return {
    create,
    update,
    delete: del,
    destructive,
    total: operations.length,
  };
}
