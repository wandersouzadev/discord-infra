import type { DiscordConfig } from "../config/types.js";
import type { DiscordServerState } from "../discord/state.js";
import { format, symbols } from "../utils/format.js";
import { computeDiff, resetOpCounter } from "./diff.js";
import { calculatePlanSummary, sortOperations } from "./operations.js";
import type { Operation, Plan } from "./types.js";

/**
 * Generate a complete, side-effect free deployment plan.
 */
export function generatePlan(desired: DiscordConfig, current: DiscordServerState): Plan {
  resetOpCounter();

  const diff = computeDiff(desired, current);
  const sortedOperations = sortOperations(diff.operations);
  const summary = calculatePlanSummary(sortedOperations);

  return {
    guildId: current.guild.id,
    guildName: current.guild.name,
    operations: sortedOperations,
    summary,
    hierarchyWarnings: diff.hierarchyWarnings,
    unmanaged: diff.unmanaged,
  };
}

/**
 * Format plan as a human-readable CLI string.
 */
export function formatPlanOutput(plan: Plan): string {
  const lines: string[] = [];

  lines.push(format.bold("Discord Infrastructure Plan"));
  lines.push(format.dim(`Guild: ${plan.guildName} (${plan.guildId})`));
  lines.push("");

  if (plan.operations.length === 0) {
    lines.push(
      format.success("No changes required. Infrastructure is in sync with desired state."),
    );
    return lines.join("\n");
  }

  // Group operations by resource type
  const roles = plan.operations.filter((op) => op.resourceType === "role");
  const emojis = plan.operations.filter((op) => op.resourceType === "emoji");
  const categories = plan.operations.filter((op) => op.resourceType === "category");
  const channels = plan.operations.filter((op) => op.resourceType === "channel");
  const permissions = plan.operations.filter((op) => op.resourceType === "permission");

  function renderOp(op: Operation): string {
    const sym = op.isDestructive
      ? symbols.destructive
      : op.type.startsWith("CREATE")
        ? symbols.add
        : op.type.startsWith("DELETE")
          ? symbols.remove
          : symbols.modify;

    let desc = op.description;
    if (op.isDestructive) {
      desc = format.error(`DELETE: ${op.resourceName}`);
    } else if (op.type.startsWith("CREATE")) {
      desc = format.create(desc);
    } else if (op.type.startsWith("DELETE")) {
      desc = format.delete(desc);
    } else {
      desc = format.update(desc);
    }

    return `  ${sym} ${desc}`;
  }

  if (roles.length > 0) {
    lines.push(format.bold("Roles"));
    for (const op of roles) {
      lines.push(renderOp(op));
    }
    lines.push("");
  }

  if (emojis.length > 0) {
    lines.push(format.bold("Emojis"));
    for (const op of emojis) {
      lines.push(renderOp(op));
    }
    lines.push("");
  }

  if (categories.length > 0) {
    lines.push(format.bold("Categories"));
    for (const op of categories) {
      lines.push(renderOp(op));
    }
    lines.push("");
  }

  if (channels.length > 0) {
    lines.push(format.bold("Channels"));
    for (const op of channels) {
      lines.push(renderOp(op));
    }
    lines.push("");
  }

  if (permissions.length > 0) {
    lines.push(format.bold("Permissions"));
    for (const op of permissions) {
      lines.push(renderOp(op));
    }
    lines.push("");
  }

  // Hierarchy Warnings
  if (plan.hierarchyWarnings.length > 0) {
    lines.push(format.error("Role Hierarchy Warnings:"));
    for (const warning of plan.hierarchyWarnings) {
      lines.push(`  ! ${warning}`);
    }
    lines.push("");
  }

  // Summary
  lines.push(format.bold("Summary:"));
  lines.push(`  Create:      ${plan.summary.create}`);
  lines.push(`  Update:      ${plan.summary.update}`);
  lines.push(`  Delete:      ${plan.summary.delete}`);
  lines.push(`  Destructive: ${plan.summary.destructive}`);

  return lines.join("\n");
}

/**
 * Format plan as a structured JSON object.
 */
export function formatPlanJson(plan: Plan): string {
  return JSON.stringify(
    {
      guild: {
        id: plan.guildId,
        name: plan.guildName,
      },
      summary: plan.summary,
      operations: plan.operations.map((op) => ({
        id: op.id,
        action: op.type.toLowerCase(),
        resourceType: op.resourceType,
        name: op.resourceName,
        isDestructive: op.isDestructive,
        description: op.description,
        changes: op.changes,
        dependsOn: op.dependsOn,
      })),
      hierarchyWarnings: plan.hierarchyWarnings,
      unmanaged: plan.unmanaged,
    },
    null,
    2,
  );
}
