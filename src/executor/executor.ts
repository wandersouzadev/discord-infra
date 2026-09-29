import type { DiscordRestClient } from "../discord/client.js";
import { ChannelType } from "../discord/types.js";
import type {
  ChannelOperationPayload,
  Operation,
  PermissionOperationPayload,
  Plan,
} from "../planner/types.js";
import { format, symbols } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import { confirmPlanExecution } from "./confirmation.js";
import type { ExecutionResult, ExecutionStep, ExecutorOptions } from "./types.js";

/**
 * Execute a validated plan against the Discord server.
 */
export async function executePlan(
  plan: Plan,
  client: DiscordRestClient,
  options: ExecutorOptions = {},
): Promise<ExecutionResult> {
  // Confirm execution first (unless dryRun or autoApprove)
  if (!options.dryRun) {
    await confirmPlanExecution(plan, options);
  }

  const completed: ExecutionStep[] = [];
  const unexecuted: Operation[] = [...plan.operations];
  const auditReason = options.auditReason ?? "discord-infra: applying declarative configuration";

  // Dynamic maps to resolve newly created resources to their assigned Discord Snowflakes
  const roleIdsByName = new Map<string, string>();
  const categoryIdsByName = new Map<string, string>();
  const channelIdsByName = new Map<string, string>();

  for (let i = 0; i < plan.operations.length; i++) {
    const op = plan.operations[i]!;
    unexecuted.shift();

    const startTime = Date.now();
    logger.debug(`[EXECUTOR] Executing ${op.type} (${op.id}): ${op.description}`);

    if (options.dryRun) {
      completed.push({
        operation: op,
        status: "SUCCESS",
        durationMs: 0,
      });
      continue;
    }

    try {
      let result: unknown;

      switch (op.type) {
        case "CREATE_ROLE": {
          const payload = op.payload as Record<string, unknown>;
          const createdRole = await client.createRole(plan.guildId, payload, auditReason);
          result = createdRole;
          roleIdsByName.set(op.resourceName.toLowerCase(), createdRole.id);
          break;
        }

        case "UPDATE_ROLE": {
          const roleId = op.resourceId!;
          const payload = op.payload as Record<string, unknown>;
          result = await client.updateRole(plan.guildId, roleId, payload, auditReason);
          break;
        }

        case "DELETE_ROLE": {
          const roleId = op.resourceId!;
          result = await client.deleteRole(plan.guildId, roleId, auditReason);
          break;
        }

        case "CREATE_CATEGORY": {
          const payload = op.payload as { name: string; position?: number };
          const createdCat = await client.createChannel(
            plan.guildId,
            {
              name: payload.name,
              type: ChannelType.GUILD_CATEGORY,
              position: payload.position,
            },
            auditReason,
          );
          result = createdCat;
          categoryIdsByName.set(op.resourceName.toLowerCase(), createdCat.id);
          break;
        }

        case "UPDATE_CATEGORY": {
          const catId = op.resourceId!;
          const payload = op.payload as Record<string, unknown>;
          result = await client.updateChannel(catId, payload, auditReason);
          break;
        }

        case "DELETE_CATEGORY": {
          const catId = op.resourceId!;
          result = await client.deleteChannel(catId, auditReason);
          break;
        }

        case "CREATE_CHANNEL": {
          const payload = op.payload as ChannelOperationPayload;
          let parentId = payload.parentId;
          if (!parentId && payload.parentCategoryName) {
            parentId = categoryIdsByName.get(payload.parentCategoryName.toLowerCase());
          }

          const createdChan = await client.createChannel(
            plan.guildId,
            {
              name: payload.name,
              type: payload.type ?? ChannelType.GUILD_TEXT,
              topic: payload.topic,
              parent_id: parentId,
              position: payload.position,
              rate_limit_per_user: payload.slowmode,
            },
            auditReason,
          );
          result = createdChan;
          channelIdsByName.set(op.resourceName.toLowerCase().replace(/^#/, ""), createdChan.id);
          break;
        }

        case "UPDATE_CHANNEL":
        case "MOVE_CHANNEL": {
          const chanId = op.resourceId!;
          const payload = { ...(op.payload as Record<string, unknown>) };

          // If moving to a newly created category, resolve parent_id
          if (
            payload.parent_id === undefined &&
            payload.category &&
            typeof payload.category === "string"
          ) {
            payload.parent_id = categoryIdsByName.get(payload.category.toLowerCase());
          }

          result = await client.updateChannel(chanId, payload, auditReason);
          break;
        }

        case "DELETE_CHANNEL": {
          const chanId = op.resourceId!;
          result = await client.deleteChannel(chanId, auditReason);
          break;
        }

        case "SET_PERMISSIONS": {
          const payload = op.payload as PermissionOperationPayload;
          let targetId = payload.targetId;
          if (!targetId) {
            const cleanTargetName = payload.targetName.toLowerCase().replace(/^#/, "");
            targetId =
              categoryIdsByName.get(cleanTargetName) ?? channelIdsByName.get(cleanTargetName);
          }

          if (!targetId) {
            throw new Error(
              `Cannot set permissions on '${payload.targetName}': target Discord ID could not be resolved.`,
            );
          }

          let roleId = payload.roleId;
          if (!roleId) {
            if (payload.roleName === "@everyone") {
              roleId = plan.guildId;
            } else {
              roleId = roleIdsByName.get(payload.roleName.toLowerCase());
            }
          }

          if (!roleId) {
            throw new Error(
              `Cannot set permissions for role '${payload.roleName}': role Discord ID could not be resolved.`,
            );
          }

          result = await client.updateChannelPermissions(
            targetId,
            roleId,
            {
              allow: payload.allow,
              deny: payload.deny,
              type: payload.type,
            },
            auditReason,
          );
          break;
        }

        case "DELETE_PERMISSIONS": {
          const targetId = op.resourceId!;
          const roleId = (op.payload as { roleId: string }).roleId;
          result = await client.deleteChannelPermissions(targetId, roleId, auditReason);
          break;
        }

        default:
          throw new Error(`Unsupported operation type: ${op.type}`);
      }

      const durationMs = Date.now() - startTime;
      completed.push({
        operation: op,
        status: "SUCCESS",
        result,
        durationMs,
      });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const failedStep: ExecutionStep = {
        operation: op,
        status: "FAILED",
        error: (err as Error).message,
        durationMs,
      };

      logger.error(`Operation failed: ${op.description}`, err);

      return {
        success: false,
        totalOperations: plan.operations.length,
        completed,
        failed: failedStep,
        unexecuted,
      };
    }
  }

  return {
    success: true,
    totalOperations: plan.operations.length,
    completed,
    unexecuted: [],
  };
}

/**
 * Format execution result as human-readable CLI output.
 */
export function formatExecutionResult(result: ExecutionResult): string {
  const lines: string[] = [];

  if (result.success) {
    lines.push(format.success("\nApply completed successfully!"));
    lines.push(format.dim(`Applied ${result.completed.length} operation(s).\n`));
    for (const step of result.completed) {
      lines.push(`  ${symbols.success} ${step.operation.description}`);
    }
  } else {
    lines.push(format.error("\nApply failed."));

    if (result.completed.length > 0) {
      lines.push("\nCompleted:");
      for (const step of result.completed) {
        lines.push(`  ${symbols.success} ${step.operation.description}`);
      }
    }

    if (result.failed) {
      lines.push("\nFailed:");
      lines.push(`  ${symbols.failure} ${result.failed.operation.description}`);
      lines.push("\nReason:");
      lines.push(`  ${format.error(result.failed.error ?? "Unknown error")}`);
    }

    if (result.unexecuted.length > 0) {
      lines.push(
        format.dim(`\nNo further operations were executed (${result.unexecuted.length} remaining).`),
      );
    }
  }

  return lines.join("\n");
}
