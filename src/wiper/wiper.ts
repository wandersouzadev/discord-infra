import type { DiscordConfig } from "../config/types.js";
import type { DiscordRestClient } from "../discord/client.js";
import { checkRoleManageability } from "../discord/hierarchy.js";
import type { DiscordServerState } from "../discord/state.js";
import type { DiscordChannel, DiscordEmoji, DiscordRole } from "../discord/types.js";
import { askQuestion } from "../executor/confirmation.js";
import { ConfirmationAbortedError, SafetyError } from "../utils/errors.js";
import { format, symbols } from "../utils/format.js";
import { logger } from "../utils/logger.js";

export interface WipeTargetOptions {
  all?: boolean;
  configOnly?: boolean;
  channelsOnly?: boolean;
  rolesOnly?: boolean;
  emojisOnly?: boolean;
}

export interface WipeOptions extends WipeTargetOptions {
  autoApprove?: boolean;
  interactive?: boolean;
  dryRun?: boolean;
  auditReason?: string;
  guildId?: string;
}

export interface WipeTargets {
  channels: DiscordChannel[];
  categories: DiscordChannel[];
  roles?: DiscordRole[];
  emojis?: DiscordEmoji[];
}

export interface WipeResult {
  deletedChannels: Array<{ id: string; name: string }>;
  deletedCategories: Array<{ id: string; name: string }>;
  deletedRoles: Array<{ id: string; name: string }>;
  deletedEmojis: Array<{ id: string; name: string }>;
  failed: Array<{
    id: string;
    name: string;
    type: "channel" | "category" | "role" | "emoji";
    error: string;
  }>;
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
 * Filter channels, categories, and roles that should be wiped based on options and config.
 * - When config is provided (and all is not set): wipes only resources declared in config.
 * - When all is true: wipes all server channels, categories, and deletable roles.
 * - When neither all nor config is provided: defaults to wiping all server resources.
 * - Respects channelsOnly and rolesOnly filters.
 */
export function selectTargetsToWipe(
  state: DiscordServerState,
  config?: DiscordConfig,
  options: WipeTargetOptions = {},
): WipeTargets {
  const isAll = Boolean(options.all);
  const isConfigOnly = Boolean(options.configOnly);
  const useConfig = !isAll && (isConfigOnly || Boolean(config));

  // --- Channels Selection ---
  let matchedChannels: DiscordChannel[] = [];
  if (!options.rolesOnly) {
    if (useConfig) {
      const desiredChannelNames = new Set(
        (config?.channels ?? []).map((c) => c.name.toLowerCase()),
      );
      const normalizedDesiredChannelNames = new Set(
        (config?.channels ?? []).map((c) => normalizeName(c.name)),
      );
      const desiredChannelIds = new Set(
        (config?.channels ?? []).map((c) => c.discord_id).filter((id): id is string => Boolean(id)),
      );

      matchedChannels = state.channels.filter((chan) => {
        if (desiredChannelIds.has(chan.id)) return true;
        if (!chan.name) return false;
        const lower = chan.name.toLowerCase();
        if (desiredChannelNames.has(lower)) return true;
        const norm = normalizeName(chan.name);
        return normalizedDesiredChannelNames.has(norm);
      });
    } else {
      matchedChannels = [...state.channels];
    }
  }

  // --- Categories Selection ---
  let matchedCategories: DiscordChannel[] = [];
  if (!options.rolesOnly && !options.channelsOnly) {
    if (useConfig) {
      const desiredCatNames = new Set((config?.categories ?? []).map((c) => c.name.toLowerCase()));
      const normalizedDesiredCatNames = new Set(
        (config?.categories ?? []).map((c) => normalizeName(c.name)),
      );
      const desiredCatIds = new Set(
        (config?.categories ?? [])
          .map((c) => c.discord_id)
          .filter((id): id is string => Boolean(id)),
      );

      matchedCategories = state.categories.filter((cat) => {
        if (desiredCatIds.has(cat.id)) return true;
        if (!cat.name) return false;
        const lower = cat.name.toLowerCase();
        if (desiredCatNames.has(lower)) return true;
        const norm = normalizeName(cat.name);
        return normalizedDesiredCatNames.has(norm);
      });
    } else {
      matchedCategories = [...state.categories];
    }
  }

  // --- Roles Selection ---
  let matchedRoles: DiscordRole[] = [];
  if (!options.channelsOnly && !options.emojisOnly) {
    if (useConfig) {
      const desiredRoleNames = new Set((config?.roles ?? []).map((r) => r.name.toLowerCase()));
      const normalizedDesiredRoleNames = new Set(
        (config?.roles ?? []).map((r) => normalizeName(r.name)),
      );
      const desiredRoleIds = new Set(
        (config?.roles ?? []).map((r) => r.discord_id).filter((id): id is string => Boolean(id)),
      );

      matchedRoles = state.roles.filter((role) => {
        // Never delete @everyone
        if (role.id === state.guild.id || role.name === "@everyone") return false;
        // Never delete managed roles
        if (role.managed) return false;

        // Check hierarchy if botContext is available
        if (state.botContext) {
          const check = checkRoleManageability(state.botContext, role, { isDeleting: true });
          if (!check.canManage) return false;
        }

        if (desiredRoleIds.has(role.id)) return true;
        const lower = role.name.toLowerCase();
        if (desiredRoleNames.has(lower)) return true;
        const norm = normalizeName(role.name);
        return normalizedDesiredRoleNames.has(norm);
      });
    } else {
      // All deletable roles on the server
      matchedRoles = state.roles.filter((role) => {
        // Never delete @everyone
        if (role.id === state.guild.id || role.name === "@everyone") return false;
        // Never delete managed roles
        if (role.managed) return false;

        // Check hierarchy if botContext is available
        if (state.botContext) {
          const check = checkRoleManageability(state.botContext, role, { isDeleting: true });
          if (!check.canManage) return false;
        }

        return true;
      });
    }

    // Sort roles descending by position (higher positions deleted first)
    matchedRoles.sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  }

  // --- Emojis Selection ---
  let matchedEmojis: DiscordEmoji[] = [];
  if (!options.rolesOnly && !options.channelsOnly) {
    if (useConfig) {
      const desiredEmojiNames = new Set((config?.emojis ?? []).map((e) => e.name.toLowerCase()));
      const desiredEmojiIds = new Set(
        (config?.emojis ?? []).map((e) => e.discord_id).filter((id): id is string => Boolean(id)),
      );

      matchedEmojis = (state.emojis ?? []).filter((emoji) => {
        if (emoji.managed) return false;
        if (desiredEmojiIds.has(emoji.id)) return true;
        if (!emoji.name) return false;
        return desiredEmojiNames.has(emoji.name.toLowerCase());
      });
    } else {
      matchedEmojis = (state.emojis ?? []).filter((emoji) => !emoji.managed);
    }
  }

  if (options.emojisOnly) {
    matchedChannels = [];
    matchedCategories = [];
    matchedRoles = [];
  }

  return {
    channels: matchedChannels,
    categories: matchedCategories,
    roles: matchedRoles,
    emojis: matchedEmojis,
  };
}

/**
 * Render a human-readable list of targets to be deleted.
 */
export function formatWipeTargets(targets: WipeTargets, guildName: string): string {
  const channels = targets.channels ?? [];
  const categories = targets.categories ?? [];
  const roles = targets.roles ?? [];
  const emojis = targets.emojis ?? [];

  const lines: string[] = [];
  lines.push(format.bold(`Wipe Targets on "${guildName}":`));

  if (
    channels.length === 0 &&
    categories.length === 0 &&
    roles.length === 0 &&
    emojis.length === 0
  ) {
    lines.push(format.dim("  No channels, categories, roles, or emojis match the wipe criteria."));
    return lines.join("\n");
  }

  if (channels.length > 0) {
    lines.push(format.bold(`\n  Channels (${channels.length}):`));
    for (const chan of channels) {
      lines.push(`    ${symbols.remove} #${chan.name ?? "unnamed"} ${format.dim(`(${chan.id})`)}`);
    }
  }

  if (categories.length > 0) {
    lines.push(format.bold(`\n  Categories (${categories.length}):`));
    for (const cat of categories) {
      lines.push(`    ${symbols.remove} ${cat.name ?? "unnamed"} ${format.dim(`(${cat.id})`)}`);
    }
  }

  if (roles.length > 0) {
    lines.push(format.bold(`\n  Roles (${roles.length}):`));
    for (const role of roles) {
      lines.push(`    ${symbols.remove} @${role.name} ${format.dim(`(${role.id})`)}`);
    }
  }

  if (emojis.length > 0) {
    lines.push(format.bold(`\n  Emojis (${emojis.length}):`));
    for (const emoji of emojis) {
      lines.push(
        `    ${symbols.remove} :${emoji.name ?? "unnamed"}: ${format.dim(`(${emoji.id})`)}`,
      );
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

  const channels = targets.channels ?? [];
  const categories = targets.categories ?? [];
  const roles = targets.roles ?? [];
  const emojis = targets.emojis ?? [];
  const total = channels.length + categories.length + roles.length + emojis.length;
  if (total === 0) {
    return;
  }

  const banner = [
    "",
    "╔══════════════════════════════════════════════════════════════════════════════╗",
    "║                       CRITICAL DESTRUCTIVE ACTION WARNING                    ║",
    "╠══════════════════════════════════════════════════════════════════════════════╣",
    `║  You are about to PERMANENTLY DELETE:                                        ║`,
    `║    • ${String(channels.length).padEnd(4)} channel(s)                                                  ║`,
    `║    • ${String(categories.length).padEnd(4)} category(ies)                                               ║`,
    `║    • ${String(roles.length).padEnd(4)} role(s)                                                      ║`,
    `║    • ${String(emojis.length).padEnd(4)} emoji(s)                                                     ║`,
    `║  from server: "${guildName.slice(0, 56).padEnd(56)}" ║`,
    "║                                                                              ║",
    "║  ALL message history, channel settings, and role configurations will be      ║",
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
      `Confirmation rejected (received "${trimmed}"). Expected "WIPE". No resources were deleted.`,
    );
  }
}

/**
 * Execute the deletion of channels, categories, and roles.
 */
export async function executeWipe(
  targets: WipeTargets,
  client: DiscordRestClient,
  options: {
    guildId?: string;
    dryRun?: boolean;
    auditReason?: string;
    onProgress?: (message: string) => void;
  } = {},
): Promise<WipeResult> {
  const result: WipeResult = {
    deletedChannels: [],
    deletedCategories: [],
    deletedRoles: [],
    deletedEmojis: [],
    failed: [],
    dryRun: Boolean(options.dryRun),
  };

  const auditReason = options.auditReason ?? "discord-infra wipe: user requested purge";
  const channels = targets.channels ?? [];
  const categories = targets.categories ?? [];
  const roles = targets.roles ?? [];
  const emojis = targets.emojis ?? [];

  // 1. Delete Channels First
  for (const chan of channels) {
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
  for (const cat of categories) {
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

  // 3. Delete Roles Third
  for (const role of roles) {
    const displayName = `@${role.name}`;
    if (options.dryRun) {
      options.onProgress?.(`[DRY-RUN] Would delete role ${displayName} (${role.id})`);
      result.deletedRoles.push({ id: role.id, name: role.name });
      continue;
    }

    try {
      options.onProgress?.(`[-] Deleting role ${displayName} (${role.id})...`);
      const targetGuildId = options.guildId ?? "";
      await client.deleteRole(targetGuildId, role.id, auditReason);
      result.deletedRoles.push({ id: role.id, name: role.name });
    } catch (err) {
      logger.error(`Failed to delete role ${displayName} (${role.id}): ${(err as Error).message}`);
      result.failed.push({
        id: role.id,
        name: role.name,
        type: "role",
        error: (err as Error).message,
      });
    }
  }

  // 4. Delete Emojis Fourth
  for (const emoji of emojis) {
    const displayName = `:${emoji.name ?? "unnamed"}:`;
    if (options.dryRun) {
      options.onProgress?.(`[DRY-RUN] Would delete emoji ${displayName} (${emoji.id})`);
      result.deletedEmojis.push({ id: emoji.id, name: emoji.name ?? "unnamed" });
      continue;
    }

    try {
      options.onProgress?.(`[-] Deleting emoji ${displayName} (${emoji.id})...`);
      const targetGuildId = options.guildId ?? "";
      await client.deleteEmoji(targetGuildId, emoji.id, auditReason);
      result.deletedEmojis.push({ id: emoji.id, name: emoji.name ?? "unnamed" });
    } catch (err) {
      logger.error(
        `Failed to delete emoji ${displayName} (${emoji.id}): ${(err as Error).message}`,
      );
      result.failed.push({
        id: emoji.id,
        name: emoji.name ?? "unnamed",
        type: "emoji",
        error: (err as Error).message,
      });
    }
  }

  return result;
}
