import { hasPermission } from "./permissions.js";
import type { DiscordGuild, DiscordGuildMember, DiscordRole, DiscordUser } from "./types.js";

export interface BotGuildContext {
  botUser: DiscordUser;
  guild: DiscordGuild;
  member: DiscordGuildMember;
  roles: DiscordRole[];
  isOwner: boolean;
  highestRolePosition: number;
  highestRole: DiscordRole | undefined;
  hasAdministrator: boolean;
  hasManageRoles: boolean;
  hasManageChannels: boolean;
}

/**
 * Build the bot's permission and role context within a guild.
 */
export function buildBotGuildContext(
  botUser: DiscordUser,
  guild: DiscordGuild,
  member: DiscordGuildMember,
  roles: DiscordRole[],
): BotGuildContext {
  const isOwner = guild.owner_id === botUser.id;

  // Find all roles assigned to the bot
  const botRoleIds = new Set(member.roles);
  // Include @everyone role (whose ID equals the guild ID)
  botRoleIds.add(guild.id);

  const assignedRoles = roles.filter((r) => botRoleIds.has(r.id));

  let highestRolePosition = -1;
  let highestRole: DiscordRole | undefined;

  for (const role of assignedRoles) {
    if (role.position > highestRolePosition) {
      highestRolePosition = role.position;
      highestRole = role;
    }
  }

  // Calculate cumulative bot permissions across all its roles
  let cumulativePerms = 0n;
  for (const role of assignedRoles) {
    try {
      cumulativePerms |= BigInt(role.permissions || "0");
    } catch {
      // Ignore invalid bitfield string
    }
  }
  const permStr = cumulativePerms.toString();

  const hasAdmin = isOwner || hasPermission(permStr, "administrator");
  const hasManageRoles = hasAdmin || hasPermission(permStr, "manage_roles");
  const hasManageChannels = hasAdmin || hasPermission(permStr, "manage_channels");

  return {
    botUser,
    guild,
    member,
    roles,
    isOwner,
    highestRolePosition,
    highestRole,
    hasAdministrator: hasAdmin,
    hasManageRoles,
    hasManageChannels,
  };
}

export interface HierarchyCheckResult {
  canManage: boolean;
  reason?: string;
}

/**
 * Verify whether the bot has permission and role hierarchy authority to manage a specific role.
 */
export function checkRoleManageability(
  context: BotGuildContext,
  targetRole: DiscordRole,
  options?: { isDeleting?: boolean; newPosition?: number },
): HierarchyCheckResult {
  // Check @everyone role: cannot be deleted by anyone, even guild owner
  if (targetRole.id === context.guild.id || targetRole.name === "@everyone") {
    if (options?.isDeleting) {
      return {
        canManage: false,
        reason: "Cannot delete the default '@everyone' role in Discord.",
      };
    }
    if (context.isOwner) {
      return { canManage: true };
    }
  }

  // Managed integration roles (e.g. Nitro Booster, Bot integration roles) cannot be modified or deleted directly
  if (targetRole.managed) {
    return {
      canManage: false,
      reason: `Role '${targetRole.name}' (${targetRole.id}) is automatically managed by a Discord integration and cannot be modified.`,
    };
  }

  // Guild owner can manage everything else
  if (context.isOwner) {
    return { canManage: true };
  }

  // Managing roles requires MANAGE_ROLES or ADMINISTRATOR
  if (!context.hasManageRoles) {
    return {
      canManage: false,
      reason: `Bot lacks 'MANAGE_ROLES' permission in guild '${context.guild.name}' (${context.guild.id}).`,
    };
  }

  // Permissions of @everyone can be modified if bot has MANAGE_ROLES
  if (targetRole.id === context.guild.id || targetRole.name === "@everyone") {
    return { canManage: true };
  }

  // Cannot delete roles assigned to the bot itself
  const isAssignedToBot =
    context.member.roles.includes(targetRole.id) || context.highestRole?.id === targetRole.id;
  if (isAssignedToBot && options?.isDeleting) {
    return {
      canManage: false,
      reason: `Cannot delete role '${targetRole.name}' (${targetRole.id}) because it is assigned to the bot.`,
    };
  }

  // Role hierarchy check: Target role position must not be strictly greater than bot's highest role position
  if (targetRole.position > context.highestRolePosition) {
    const botRoleName = context.highestRole?.name ?? "Unknown";
    return {
      canManage: false,
      reason:
        `Role hierarchy restriction: Cannot manage role '${targetRole.name}' (position ${targetRole.position}). ` +
        `The bot's highest role is '${botRoleName}' (position ${context.highestRolePosition}). ` +
        `In Discord, bots can only manage roles positioned lower than their highest role.`,
    };
  }

  // If role is at the same position and is assigned to the bot, it cannot manage its own role
  if (targetRole.position === context.highestRolePosition && isAssignedToBot) {
    return {
      canManage: false,
      reason: `Role hierarchy restriction: Cannot manage bot's own role '${targetRole.name}' (position ${targetRole.position}).`,
    };
  }

  // If reordering, the new target position must also be strictly lower than bot's highest role position
  if (options?.newPosition !== undefined && options.newPosition >= context.highestRolePosition) {
    const botRoleName = context.highestRole?.name ?? "Unknown";
    return {
      canManage: false,
      reason:
        `Role hierarchy restriction: Cannot move role '${targetRole.name}' to position ${options.newPosition}. ` +
        `The bot's highest role is '${botRoleName}' (position ${context.highestRolePosition}). ` +
        `A bot cannot position any role at or above its highest role.`,
    };
  }

  return { canManage: true };
}
