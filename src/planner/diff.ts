import { resolveEmojiDataUri } from "../config/loader.js";
import { parseColorToNumber } from "../config/schema.js";
import type { DiscordConfig } from "../config/types.js";
import { checkRoleManageability } from "../discord/hierarchy.js";
import {
  overwritesToPermissionMap,
  permissionMapToOverwrites,
  permissionsToBitfield,
} from "../discord/permissions.js";
import type { DiscordServerState } from "../discord/state.js";
import {
  ChannelType,
  type DiscordChannel,
  type DiscordEmoji,
  type DiscordRole,
} from "../discord/types.js";
import type {
  ChannelOperationPayload,
  EmojiOperationPayload,
  Operation,
  PermissionOperationPayload,
  PropertyChange,
  UnmanagedResources,
} from "./types.js";

export interface DiffResult {
  operations: Operation[];
  hierarchyWarnings: string[];
  unmanaged: UnmanagedResources;
}

/**
 * Helper to generate unique operation IDs.
 */
let opCounter = 0;
function nextOpId(prefix: string): string {
  opCounter++;
  return `${prefix}-${opCounter}`;
}

export function resetOpCounter(): void {
  opCounter = 0;
}

export function computeDiff(desired: DiscordConfig, current: DiscordServerState): DiffResult {
  const operations: Operation[] = [];
  const hierarchyWarnings: string[] = [];

  const unmanaged: UnmanagedResources = {
    roles: [],
    categories: [],
    channels: [],
    emojis: [],
  };

  // ----------------------------------------------------
  // 1. Roles Diffing
  // ----------------------------------------------------
  const matchedRoleIds = new Set<string>();
  const createdRoleOpIds = new Map<string, string>(); // role name (lower) -> op id

  for (const desiredRole of desired.roles ?? []) {
    const lowerName = desiredRole.name.toLowerCase();

    // Match by ID if specified, else match by name
    let existingRole: DiscordRole | undefined;
    if (desiredRole.discord_id) {
      existingRole = current.rolesById.get(desiredRole.discord_id);
    }
    if (!existingRole) {
      existingRole = current.rolesByName.get(lowerName);
    }

    if (!existingRole) {
      // Role needs to be created
      const opId = nextOpId("role-create");
      createdRoleOpIds.set(lowerName, opId);

      const colorInt = parseColorToNumber(desiredRole.color) ?? 0;
      const permsBitfield = desiredRole.permissions
        ? permissionsToBitfield(desiredRole.permissions)
        : undefined;

      const changes: PropertyChange[] = [
        { property: "name", oldValue: null, newValue: desiredRole.name },
      ];
      if (colorInt > 0) {
        changes.push({ property: "color", oldValue: 0, newValue: desiredRole.color });
      }
      if (desiredRole.hoist !== undefined) {
        changes.push({ property: "hoist", oldValue: false, newValue: desiredRole.hoist });
      }
      if (desiredRole.mentionable !== undefined) {
        changes.push({
          property: "mentionable",
          oldValue: false,
          newValue: desiredRole.mentionable,
        });
      }

      operations.push({
        id: opId,
        type: "CREATE_ROLE",
        resourceType: "role",
        resourceName: desiredRole.name,
        isDestructive: false,
        description: `Create role: ${desiredRole.name}`,
        changes,
        payload: {
          name: desiredRole.name,
          color: colorInt,
          hoist: desiredRole.hoist ?? false,
          mentionable: desiredRole.mentionable ?? false,
          permissions: permsBitfield,
        },
        dependsOn: [],
      });
    } else {
      matchedRoleIds.add(existingRole.id);

      // Check manageability under Discord role hierarchy
      const manageCheck = checkRoleManageability(current.botContext, existingRole);
      if (!manageCheck.canManage && manageCheck.reason) {
        hierarchyWarnings.push(manageCheck.reason);
      }

      const changes: PropertyChange[] = [];
      const payload: Record<string, unknown> = {};

      // Name change (e.g. casing change or rename via discord_id)
      if (existingRole.name !== desiredRole.name) {
        changes.push({
          property: "name",
          oldValue: existingRole.name,
          newValue: desiredRole.name,
        });
        payload.name = desiredRole.name;
      }

      // Color change
      const desiredColorInt = parseColorToNumber(desiredRole.color);
      if (desiredColorInt !== undefined && existingRole.color !== desiredColorInt) {
        changes.push({
          property: "color",
          oldValue: existingRole.color,
          newValue: desiredColorInt,
        });
        payload.color = desiredColorInt;
      }

      // Hoist change
      if (desiredRole.hoist !== undefined && existingRole.hoist !== desiredRole.hoist) {
        changes.push({
          property: "hoist",
          oldValue: existingRole.hoist,
          newValue: desiredRole.hoist,
        });
        payload.hoist = desiredRole.hoist;
      }

      // Mentionable change
      if (
        desiredRole.mentionable !== undefined &&
        existingRole.mentionable !== desiredRole.mentionable
      ) {
        changes.push({
          property: "mentionable",
          oldValue: existingRole.mentionable,
          newValue: desiredRole.mentionable,
        });
        payload.mentionable = desiredRole.mentionable;
      }

      // Role permissions change
      if (desiredRole.permissions !== undefined) {
        const desiredPermsBitfield = permissionsToBitfield(desiredRole.permissions);
        if (existingRole.permissions !== desiredPermsBitfield) {
          changes.push({
            property: "permissions",
            oldValue: existingRole.permissions,
            newValue: desiredPermsBitfield,
          });
          payload.permissions = desiredPermsBitfield;
        }
      }

      if (changes.length > 0) {
        operations.push({
          id: nextOpId("role-update"),
          type: "UPDATE_ROLE",
          resourceType: "role",
          resourceName: desiredRole.name,
          resourceId: existingRole.id,
          isDestructive: false,
          description: `Update role: ${desiredRole.name}`,
          changes,
          payload,
          dependsOn: [],
        });
      }
    }
  }

  // Detect unmanaged roles in Discord
  for (const role of current.roles) {
    // Skip @everyone (id === guild.id) and bot/integration managed roles
    if (role.id === current.guild.id || role.managed) continue;
    if (!matchedRoleIds.has(role.id)) {
      unmanaged.roles.push({ id: role.id, name: role.name });
    }
  }

  // ----------------------------------------------------
  // 2. Categories Diffing
  // ----------------------------------------------------
  const matchedCategoryIds = new Set<string>();
  const createdCategoryOpIds = new Map<string, string>(); // category name (lower) -> op id
  const targetCategoryMap = new Map<string, DiscordChannel>(); // desired name (lower) -> existing category

  for (const desiredCat of desired.categories ?? []) {
    const lowerName = desiredCat.name.toLowerCase();

    let existingCat: DiscordChannel | undefined;
    if (desiredCat.discord_id) {
      existingCat = current.categoriesById.get(desiredCat.discord_id);
    }
    if (!existingCat) {
      existingCat = current.categoriesByName.get(lowerName);
    }

    if (!existingCat) {
      const opId = nextOpId("cat-create");
      createdCategoryOpIds.set(lowerName, opId);

      operations.push({
        id: opId,
        type: "CREATE_CATEGORY",
        resourceType: "category",
        resourceName: desiredCat.name,
        isDestructive: false,
        description: `Create category: ${desiredCat.name}`,
        changes: [{ property: "name", oldValue: null, newValue: desiredCat.name }],
        payload: {
          name: desiredCat.name,
          type: ChannelType.GUILD_CATEGORY,
          position: desiredCat.position,
        },
        dependsOn: [],
      });
    } else {
      matchedCategoryIds.add(existingCat.id);
      targetCategoryMap.set(lowerName, existingCat);

      const changes: PropertyChange[] = [];
      const payload: Record<string, unknown> = {};

      if (existingCat.name !== desiredCat.name) {
        changes.push({
          property: "name",
          oldValue: existingCat.name,
          newValue: desiredCat.name,
        });
        payload.name = desiredCat.name;
      }

      if (desiredCat.position !== undefined && existingCat.position !== desiredCat.position) {
        changes.push({
          property: "position",
          oldValue: existingCat.position,
          newValue: desiredCat.position,
        });
        payload.position = desiredCat.position;
      }

      if (changes.length > 0) {
        operations.push({
          id: nextOpId("cat-update"),
          type: "UPDATE_CATEGORY",
          resourceType: "category",
          resourceName: desiredCat.name,
          resourceId: existingCat.id,
          isDestructive: false,
          description: `Update category: ${desiredCat.name}`,
          changes,
          payload,
          dependsOn: [],
        });
      }
    }
  }

  // Detect unmanaged categories
  for (const cat of current.categories) {
    if (!matchedCategoryIds.has(cat.id)) {
      unmanaged.categories.push({ id: cat.id, name: cat.name ?? "unnamed-category" });
    }
  }

  // ----------------------------------------------------
  // 3. Channels Diffing
  // ----------------------------------------------------
  const matchedChannelIds = new Set<string>();
  const createdChannelOpIds = new Map<string, string>(); // "category:channel" -> op id
  const targetChannelMap = new Map<string, DiscordChannel>(); // desired channel name (lower) -> existing channel

  for (const desiredChan of desired.channels ?? []) {
    const lowerName = desiredChan.name.toLowerCase();
    const parentCategoryName = desiredChan.category;
    const lowerCat = (parentCategoryName ?? "__root__").toLowerCase();
    const channelKey = `${lowerCat}:${lowerName}`;

    // Find existing channel: match by discord_id first, then name + category
    let existingChan: DiscordChannel | undefined;
    if (desiredChan.discord_id) {
      existingChan = current.channelsById.get(desiredChan.discord_id);
    }

    if (!existingChan) {
      // Find candidate channels matching the name
      const candidates = current.channelsByName.get(lowerName) ?? [];
      for (const cand of candidates) {
        const candParent = cand.parent_id ? current.categoriesById.get(cand.parent_id) : undefined;
        const candCatName = candParent?.name?.toLowerCase();
        if (parentCategoryName) {
          if (candCatName === parentCategoryName.toLowerCase()) {
            existingChan = cand;
            break;
          }
        } else if (!cand.parent_id) {
          existingChan = cand;
          break;
        }
      }

      // If still not matched, check if there's a unique channel with this name that might be moving category
      if (!existingChan && candidates.length === 1 && parentCategoryName) {
        existingChan = candidates[0];
      }
    }

    // Determine category ID or dependency
    let targetParentId: string | null = null;
    const dependsOn: string[] = [];

    if (parentCategoryName) {
      const lowerParent = parentCategoryName.toLowerCase();
      const existingParent =
        targetCategoryMap.get(lowerParent) ?? current.categoriesByName.get(lowerParent);
      if (existingParent) {
        targetParentId = existingParent.id;
      } else {
        const catOpId = createdCategoryOpIds.get(lowerParent);
        if (catOpId) {
          dependsOn.push(catOpId);
        }
      }
    }

    const channelPayload: ChannelOperationPayload = {
      name: desiredChan.name,
      type: ChannelType.GUILD_TEXT,
      topic: desiredChan.topic,
      parentId: targetParentId ?? undefined,
      parentCategoryName,
      position: desiredChan.position,
      slowmode: desiredChan.slowmode,
    };

    if (!existingChan) {
      const opId = nextOpId("chan-create");
      createdChannelOpIds.set(channelKey, opId);

      const changes: PropertyChange[] = [
        { property: "name", oldValue: null, newValue: desiredChan.name },
      ];
      if (parentCategoryName) {
        changes.push({ property: "category", oldValue: null, newValue: parentCategoryName });
      }
      if (desiredChan.topic) {
        changes.push({ property: "topic", oldValue: null, newValue: desiredChan.topic });
      }

      operations.push({
        id: opId,
        type: "CREATE_CHANNEL",
        resourceType: "channel",
        resourceName: `#${desiredChan.name}`,
        isDestructive: false,
        description: `Create #${desiredChan.name}${parentCategoryName ? ` in ${parentCategoryName}` : ""}`,
        changes,
        payload: channelPayload,
        dependsOn,
      });
    } else {
      matchedChannelIds.add(existingChan.id);
      targetChannelMap.set(lowerName, existingChan);

      const changes: PropertyChange[] = [];
      const payload: Record<string, unknown> = {};

      if (existingChan.name !== desiredChan.name) {
        changes.push({
          property: "name",
          oldValue: existingChan.name,
          newValue: desiredChan.name,
        });
        payload.name = desiredChan.name;
      }

      // Check category move
      const currentParent = existingChan.parent_id
        ? current.categoriesById.get(existingChan.parent_id)
        : undefined;
      const currentCatName = currentParent?.name;

      const currentParentId = existingChan.parent_id ?? null;
      const isParentChanged = parentCategoryName
        ? targetParentId !== currentParentId
        : currentParentId !== null;

      if (isParentChanged) {
        changes.push({
          property: "category",
          oldValue: currentCatName ?? "None",
          newValue: parentCategoryName ?? "None",
        });
        payload.parent_id = targetParentId;
      }

      // Check topic
      const desiredTopic = desiredChan.topic ?? null;
      if (desiredTopic !== null && existingChan.topic !== desiredTopic) {
        changes.push({
          property: "topic",
          oldValue: existingChan.topic,
          newValue: desiredTopic,
        });
        payload.topic = desiredTopic;
      }

      // Check slowmode
      if (
        desiredChan.slowmode !== undefined &&
        existingChan.rate_limit_per_user !== desiredChan.slowmode
      ) {
        changes.push({
          property: "slowmode",
          oldValue: existingChan.rate_limit_per_user,
          newValue: desiredChan.slowmode,
        });
        payload.rate_limit_per_user = desiredChan.slowmode;
      }

      // Check position
      if (desiredChan.position !== undefined && existingChan.position !== desiredChan.position) {
        changes.push({
          property: "position",
          oldValue: existingChan.position,
          newValue: desiredChan.position,
        });
        payload.position = desiredChan.position;
      }

      if (changes.length > 0) {
        const isMove = changes.some((c) => c.property === "category");
        operations.push({
          id: nextOpId(isMove ? "chan-move" : "chan-update"),
          type: isMove ? "MOVE_CHANNEL" : "UPDATE_CHANNEL",
          resourceType: "channel",
          resourceName: `#${desiredChan.name}`,
          resourceId: existingChan.id,
          isDestructive: false,
          description: isMove
            ? `Move #${desiredChan.name} -> ${parentCategoryName ?? "None"}`
            : `Update #${desiredChan.name}`,
          changes,
          payload,
          dependsOn,
        });
      }
    }
  }

  // Detect unmanaged channels
  for (const chan of current.channels) {
    if (!matchedChannelIds.has(chan.id)) {
      const parentName = chan.parent_id
        ? current.categoriesById.get(chan.parent_id)?.name
        : undefined;
      unmanaged.channels.push({
        id: chan.id,
        name: chan.name ?? "unnamed-channel",
        category: parentName,
      });
    }
  }

  // ----------------------------------------------------
  // 4. Permissions Diffing (Categories and Channels)
  // ----------------------------------------------------
  // Build a consolidated permissions map: TargetName -> RoleName -> PermMap
  const consolidatedPermissions = new Map<string, Map<string, Record<string, boolean>>>();

  // 1) From desired.permissions (global section)
  if (desired.permissions) {
    for (const [targetName, rolePerms] of Object.entries(desired.permissions)) {
      const targetLower = targetName.toLowerCase();
      let targetMap = consolidatedPermissions.get(targetLower);
      if (!targetMap) {
        targetMap = new Map();
        consolidatedPermissions.set(targetLower, targetMap);
      }
      for (const [roleName, perms] of Object.entries(rolePerms)) {
        targetMap.set(roleName, perms);
      }
    }
  }

  // 2) From inline channel permissions
  for (const chan of desired.channels ?? []) {
    if (chan.permissions) {
      const chanLower = chan.name.toLowerCase();
      let targetMap = consolidatedPermissions.get(chanLower);
      if (!targetMap) {
        targetMap = new Map();
        consolidatedPermissions.set(chanLower, targetMap);
      }
      for (const [roleName, perms] of Object.entries(chan.permissions)) {
        targetMap.set(roleName, perms);
      }
    }
  }

  // Compare consolidated permissions against Discord state
  for (const [targetNameLower, rolePermMap] of consolidatedPermissions) {
    // Find target channel or category in Discord (check matched resources first for renamed targets)
    const targetCat =
      targetCategoryMap.get(targetNameLower) ?? current.categoriesByName.get(targetNameLower);
    const targetChan =
      targetChannelMap.get(targetNameLower) ?? current.channelsByName.get(targetNameLower)?.[0];

    const target = targetCat ?? targetChan;
    const targetType = targetCat ? "category" : "channel";
    const targetDisplayName = targetCat
      ? (targetCat.name ?? targetNameLower)
      : `#${targetChan?.name ?? targetNameLower}`;

    // Dependencies if the target is newly created
    const targetDependsOn: string[] = [];
    if (!target) {
      const catOp = createdCategoryOpIds.get(targetNameLower);
      if (catOp) targetDependsOn.push(catOp);
      // Also check channel
      for (const [key, opId] of createdChannelOpIds) {
        if (key.endsWith(`:${targetNameLower}`)) {
          targetDependsOn.push(opId);
        }
      }
    }

    for (const [roleName, perms] of rolePermMap) {
      const isEveryone = roleName === "@everyone";
      let roleId: string | undefined;
      const roleDependsOn: string[] = [...targetDependsOn];

      if (isEveryone) {
        roleId = current.guild.id;
      } else {
        const foundRole = current.rolesByName.get(roleName.toLowerCase());
        if (foundRole) {
          roleId = foundRole.id;
        } else {
          const roleOp = createdRoleOpIds.get(roleName.toLowerCase());
          if (roleOp) {
            roleDependsOn.push(roleOp);
          }
        }
      }

      const { allow: desiredAllow, deny: desiredDeny } = permissionMapToOverwrites(perms);

      // Find existing overwrite on target
      const existingOverwrite = target?.permission_overwrites?.find((ow) => {
        if (roleId) return ow.id === roleId;
        return false;
      });

      let needsUpdate = false;
      const changes: PropertyChange[] = [];

      if (!existingOverwrite) {
        needsUpdate = true;
        changes.push({
          property: `permissions[${roleName}]`,
          oldValue: null,
          newValue: perms,
        });
      } else {
        const existingMap = overwritesToPermissionMap(
          existingOverwrite.allow,
          existingOverwrite.deny,
        );

        // Compare individual permission flags
        for (const [permKey, desiredVal] of Object.entries(perms)) {
          if (existingMap[permKey] !== desiredVal) {
            changes.push({
              property: `${roleName}.${permKey}`,
              oldValue: existingMap[permKey] ?? "neutral",
              newValue: desiredVal,
            });
            needsUpdate = true;
          }
        }
      }

      if (needsUpdate) {
        const payload: PermissionOperationPayload = {
          targetId: target?.id,
          targetName: targetDisplayName,
          targetType,
          roleName,
          roleId,
          allow: desiredAllow,
          deny: desiredDeny,
          type: 0, // Role overwrite
        };

        operations.push({
          id: nextOpId("perm-set"),
          type: "SET_PERMISSIONS",
          resourceType: "permission",
          resourceName: `${targetDisplayName} [${roleName}]`,
          resourceId: target?.id,
          isDestructive: false,
          description: `Update permissions on ${targetDisplayName} for ${roleName}`,
          changes,
          payload,
          dependsOn: roleDependsOn,
        });
      }
    }
  }

  // ----------------------------------------------------
  // 5. Emojis Diffing
  // ----------------------------------------------------
  const matchedEmojiIds = new Set<string>();

  for (const desiredEmoji of desired.emojis ?? []) {
    const lowerName = desiredEmoji.name.toLowerCase();

    let existingEmoji: DiscordEmoji | undefined;
    if (desiredEmoji.discord_id) {
      existingEmoji = current.emojisById.get(desiredEmoji.discord_id);
    }
    if (!existingEmoji) {
      existingEmoji = current.emojisByName.get(lowerName);
    }

    if (!existingEmoji) {
      // EMOJI CREATION
      const opId = nextOpId("emoji-create");
      const dependsOn: string[] = [];

      // Check if allowed roles depend on roles being created and map existing roles
      const roleMap: Record<string, string> = {};
      if (desiredEmoji.roles) {
        for (const roleName of desiredEmoji.roles) {
          const lowerRole = roleName.toLowerCase();
          const existingRole = current.rolesByName.get(lowerRole);
          if (existingRole) {
            roleMap[lowerRole] = existingRole.id;
          }
          const roleOpId = createdRoleOpIds.get(lowerRole);
          if (roleOpId) {
            dependsOn.push(roleOpId);
          }
        }
      }

      let imageDataUri: string | undefined;
      try {
        imageDataUri = resolveEmojiDataUri(desiredEmoji);
      } catch {
        imageDataUri = desiredEmoji.image;
      }

      const payload: EmojiOperationPayload = {
        name: desiredEmoji.name,
        image: imageDataUri,
        roles: desiredEmoji.roles,
        roleMap,
        file: desiredEmoji.file,
      };

      operations.push({
        id: opId,
        type: "CREATE_EMOJI",
        resourceType: "emoji",
        resourceName: `:${desiredEmoji.name}:`,
        isDestructive: false,
        description: `Create emoji: :${desiredEmoji.name}:`,
        changes: [{ property: "name", oldValue: null, newValue: desiredEmoji.name }],
        payload,
        dependsOn,
      });
    } else {
      // EMOJI EXISTS - check for updates
      matchedEmojiIds.add(existingEmoji.id);

      const changes: PropertyChange[] = [];
      const dependsOn: string[] = [];
      const roleMap: Record<string, string> = {};

      // Check name change (e.g. matched by discord_id)
      if (existingEmoji.name && existingEmoji.name !== desiredEmoji.name) {
        changes.push({
          property: "name",
          oldValue: existingEmoji.name,
          newValue: desiredEmoji.name,
        });
      }

      // Check roles change
      if (desiredEmoji.roles !== undefined) {
        // Convert existing role IDs to role names
        const existingRoleNames = (existingEmoji.roles ?? [])
          .map((rId) => current.rolesById.get(rId)?.name)
          .filter((name): name is string => Boolean(name))
          .sort();

        const desiredRoleNames = [...desiredEmoji.roles].sort();

        const rolesChanged =
          existingRoleNames.length !== desiredRoleNames.length ||
          existingRoleNames.some(
            (r, idx) => r.toLowerCase() !== desiredRoleNames[idx]?.toLowerCase(),
          );

        for (const roleName of desiredEmoji.roles) {
          const lowerRole = roleName.toLowerCase();
          const existingRole = current.rolesByName.get(lowerRole);
          if (existingRole) {
            roleMap[lowerRole] = existingRole.id;
          }
          const roleOpId = createdRoleOpIds.get(lowerRole);
          if (roleOpId) {
            dependsOn.push(roleOpId);
          }
        }

        if (rolesChanged) {
          changes.push({
            property: "roles",
            oldValue: existingRoleNames,
            newValue: desiredRoleNames,
          });
        }
      }

      if (changes.length > 0) {
        const payload: EmojiOperationPayload = {
          name: desiredEmoji.name,
          roles: desiredEmoji.roles,
          roleMap,
        };

        operations.push({
          id: nextOpId("emoji-update"),
          type: "UPDATE_EMOJI",
          resourceType: "emoji",
          resourceName: `:${desiredEmoji.name}:`,
          resourceId: existingEmoji.id,
          isDestructive: false,
          description: `Update emoji: :${desiredEmoji.name}:`,
          changes,
          payload,
          dependsOn,
        });
      }
    }
  }

  // Detect unmanaged emojis (skip bot/integration managed emojis)
  for (const currentEmoji of current.emojis ?? []) {
    if (currentEmoji.managed) continue;
    if (!matchedEmojiIds.has(currentEmoji.id)) {
      unmanaged.emojis.push({
        id: currentEmoji.id,
        name: currentEmoji.name ?? "unnamed",
      });
    }
  }

  return {
    operations,
    hierarchyWarnings,
    unmanaged,
  };
}
