import type { DiscordConfig } from "../config/types.js";
import type { DiscordRestClient } from "../discord/client.js";
import type { DiscordServerState } from "../discord/state.js";
import type { DiscordChannel } from "../discord/types.js";
import { askQuestion } from "../executor/confirmation.js";
import { ConfirmationAbortedError, SafetyError } from "../utils/errors.js";
import { format, symbols } from "../utils/format.js";
import { logger } from "../utils/logger.js";

export interface WipeTargetOptions {
  all?: boolean;
  configOnly?: boolean;
  channelsOnly?: boolean;
}

export interface WipeOptions extends WipeTargetOptions {
  autoApprove?: boolean;
  interactive?: boolean;
  dryRun?: boolean;
  auditReason?: string;
}

export interface WipeTargets {
  channels: DiscordChannel[];
  categories: DiscordChannel[];
}

export interface WipeResult {
  deletedChannels: Array<{ id: string; name: string }>;
  deletedCategories: Array<{ id: string; name: string }>;
  failed: Array<{ id: string; name: string; type: "channel" | "category"; error: string }>;
  dryRun: boolean;
}

/**
 * Helper to strip decorative emojis and symbols for matching.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^[^\p{Letter}\p{Number}]+/u, "")
    .replace(/[^\p{Letter}\p{Number}]+$/u, "")
    .trim();
}

/**
 * Filter channels and categories that should be wiped based on options and config.
 * By default, wipe purges ALL channels and categories on the server unless configOnly is specified.
 */
export function selectTargetsToWipe(
  state: DiscordServerState,
  config?: DiscordConfig,
  options: WipeTargetOptions = {},
): WipeTargets {
  // Only restrict to config resources if configOnly is explicitly passed
  const isConfigOnly = Boolean(options.configOnly);

  if (!isConfigOnly) {
    // Wipe all channels and categories on the server
    return {
      channels: [...state.channels],
      categories: options.channelsOnly ? [] : [...state.categories],
    };
  }

  // Config-only matching
  const desiredChannelNames = new Set((config?.channels ?? []).map((c) => c.name.toLowerCase()));
  const normalizedDesiredChannelNames = new Set(
    (config?.channels ?? []).map((c) => normalizeName(c.name)),
  );
  const desiredChannelIds = new Set(
    (config?.channels ?? []).map((c) => c.discord_id).filter((id): id is string => Boolean(id)),
  );

  const matchedChannels = state.channels.filter((chan) => {
    if (desiredChannelIds.has(chan.id)) return true;
    if (!chan.name) return false;
    const lower = chan.name.toLowerCase();
    if (desiredChannelNames.has(lower)) return true;
    const norm = normalizeName(chan.name);
    return normalizedDesiredChannelNames.has(norm);
  });

  if (options.channelsOnly) {
    return {
      channels: matchedChannels,
      categories: [],
    };
  }

  const desiredCatNames = new Set((config?.categories ?? []).map((c) => c.name.toLowerCase()));
  const normalizedDesiredCatNames = new Set(
    (config?.categories ?? []).map((c) => normalizeName(c.name)),
  );
  const desiredCatIds = new Set(
    (config?.categories ?? []).map((c) => c.discord_id).filter((id): id is string => Boolean(id)),
  );

  const matchedCategories = state.categories.filter((cat) => {
    if (desiredCatIds.has(cat.id)) return true;
    if (!cat.name) return false;
    const lower = cat.name.toLowerCase();
    if (desiredCatNames.has(lower)) return true;
    const norm = normalizeName(cat.name);
    return normalizedDesiredCatNames.has(norm);
  });

  return {
    channels: matchedChannels,
    categories: matchedCategories,
  };
}

/**
 * Render a human-readable list of targets to be deleted.
 */
export function formatWipeTargets(targets: WipeTargets, guildName: string): string {
  const lines: string[] = [];
  lines.push(format.bold(`Wipe Targets on "${guildName}":`));

  if (targets.channels.length === 0 && targets.categories.length === 0) {
    lines.push(format.dim("  No channels or categories match the wipe criteria."));
    return lines.join("\n");
  }

  if (targets.channels.length > 0) {
    lines.push(format.bold(`\n  Channels (${targets.channels.length}):`));
    for (const chan of targets.channels) {
      lines.push(`    ${symbols.remove} #${chan.name ?? "unnamed"} ${format.dim(`(${chan.id})`)}`);
    }
  }

  if (targets.categories.length > 0) {
    lines.push(format.bold(`\n  Categories (${targets.categories.length}):`));
    for (const cat of targets.categories) {
      lines.push(`    ${symbols.remove} ${cat.name ?? "unnamed"} ${format.dim(`(${cat.id})`)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Display prominent red warning banner and require explicit confirmation.
 */
export async function confirmWipeExecution(
  targets: WipeTargets,
  guildName: string,
  options: { autoApprove?: boolean; interactive?: boolean } = {},
): Promise<void> {
  if (options.autoApprove) {
    return;
  }

  const isInteractive = options.interactive !== false && Boolean(process.stdin.isTTY);
  if (!isInteractive) {
    throw new SafetyError(
      "Destructive wipe command invoked in non-interactive environment without '--yes'. Execution aborted for safety.",
    );
  }

  const total = targets.channels.length + targets.categories.length;
  if (total === 0) {
    return;
  }

  const banner = [
    "",
    "╔══════════════════════════════════════════════════════════════════════════════╗",
    "║                       CRITICAL DESTRUCTIVE ACTION WARNING                    ║",
    "╠══════════════════════════════════════════════════════════════════════════════╣",
    `║  You are about to PERMANENTLY DELETE:                                        ║`,
    `║    • ${String(targets.channels.length).padEnd(4)} channel(s)                                                  ║`,
    `║    • ${String(targets.categories.length).padEnd(4)} category(ies)                                               ║`,
    `║  from server: "${guildName.slice(0, 56).padEnd(56)}" ║`,
    "║                                                                              ║",
    "║  ALL message history, uploaded media, pinned messages, and threads will be  ║",
    "║  PERMANENTLY DESTROYED.                                                      ║",
    "║                                                                              ║",
    "║  THIS ACTION IS IRREVERSIBLE AND CANNOT BE UNDONE!                           ║",
    "╚══════════════════════════════════════════════════════════════════════════════╝",
    "",
  ].join("\n");

  console.log(format.error(banner));

  const answer = await askQuestion(
    format.bold('Type "WIPE" to confirm and permanently delete these resources: '),
  );

  const trimmed = answer.trim();
  if (trimmed !== "WIPE" && trimmed !== "DELETE") {
    throw new ConfirmationAbortedError(
      `Confirmation rejected (received "${trimmed}"). Expected "WIPE". No channels were deleted.`,
    );
  }
}

/**
 * Execute the deletion of channels and categories.
 */
export async function executeWipe(
  targets: WipeTargets,
  client: DiscordRestClient,
  options: {
    dryRun?: boolean;
    auditReason?: string;
    onProgress?: (message: string) => void;
  } = {},
): Promise<WipeResult> {
  const result: WipeResult = {
    deletedChannels: [],
    deletedCategories: [],
    failed: [],
    dryRun: Boolean(options.dryRun),
  };

  const auditReason = options.auditReason ?? "discord-infra wipe: user requested channel purge";

  // 1. Delete Channels First
  for (const chan of targets.channels) {
    const displayName = `#${chan.name ?? "unnamed"}`;
    if (options.dryRun) {
      options.onProgress?.(`[DRY-RUN] Would delete channel ${displayName} (${chan.id})`);
      result.deletedChannels.push({ id: chan.id, name: chan.name ?? "unnamed" });
      continue;
    }

    try {
      options.onProgress?.(`[-] Deleting channel ${displayName} (${chan.id})...`);
      await client.deleteChannel(chan.id, auditReason);
      result.deletedChannels.push({ id: chan.id, name: chan.name ?? "unnamed" });
    } catch (err) {
      logger.error(
        `Failed to delete channel ${displayName} (${chan.id}): ${(err as Error).message}`,
      );
      result.failed.push({
        id: chan.id,
        name: chan.name ?? "unnamed",
        type: "channel",
        error: (err as Error).message,
      });
    }
  }

  // 2. Delete Categories Second
  for (const cat of targets.categories) {
    const displayName = cat.name ?? "unnamed-category";
    if (options.dryRun) {
      options.onProgress?.(`[DRY-RUN] Would delete category ${displayName} (${cat.id})`);
      result.deletedCategories.push({ id: cat.id, name: displayName });
      continue;
    }

    try {
      options.onProgress?.(`[-] Deleting category ${displayName} (${cat.id})...`);
      await client.deleteChannel(cat.id, auditReason);
      result.deletedCategories.push({ id: cat.id, name: displayName });
    } catch (err) {
      logger.error(
        `Failed to delete category ${displayName} (${cat.id}): ${(err as Error).message}`,
      );
      result.failed.push({
        id: cat.id,
        name: displayName,
        type: "category",
        error: (err as Error).message,
      });
    }
  }

  return result;
}
