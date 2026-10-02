import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { numberToHexColor } from "../config/schema.js";
import type {
  CategoryConfig,
  ChannelConfig,
  DiscordConfig,
  PermissionsConfig,
  RoleConfig,
} from "../config/types.js";
import { bitfieldToPermissions, overwritesToPermissionMap } from "../discord/permissions.js";
import type { DiscordServerState } from "../discord/state.js";
import { ChannelType } from "../discord/types.js";

export interface ExportOptions {
  outputDir?: string;
  singleFile?: boolean;
  includeIds?: boolean;
}

export interface ExportConfigOptions {
  includeIds?: boolean;
}

/**
 * Convert DiscordServerState into a clean, human-readable DiscordConfig object.
 */
export function exportStateToConfig(
  state: DiscordServerState,
  options: ExportConfigOptions = {},
): DiscordConfig {
  const roles: RoleConfig[] = [];
  const categories: CategoryConfig[] = [];
  const channels: ChannelConfig[] = [];
  const permissions: PermissionsConfig = {};

  // 1. Roles
  for (const role of state.roles) {
    // Skip @everyone and integration managed roles
    if (role.id === state.guild.id || role.managed) {
      continue;
    }

    const roleConfig: RoleConfig = {
      name: role.name,
      ...(options.includeIds ? { discord_id: role.id } : {}),
    };

    const hexColor = numberToHexColor(role.color);
    if (hexColor) roleConfig.color = hexColor;
    if (role.hoist) roleConfig.hoist = true;
    if (role.mentionable) roleConfig.mentionable = true;
    if (role.position > 0) roleConfig.position = role.position;

    const grantedPerms = bitfieldToPermissions(role.permissions);
    if (grantedPerms.length > 0) {
      roleConfig.permissions = grantedPerms;
    }

    roles.push(roleConfig);
  }

  // Sort roles descending by position for natural readability
  roles.sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

  // 2. Categories
  for (const cat of state.categories) {
    categories.push({
      name: cat.name ?? "unnamed-category",
      position: cat.position,
      ...(options.includeIds ? { discord_id: cat.id } : {}),
    });
  }
  categories.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // 3. Channels
  for (const chan of state.channels) {
    const parentCat = chan.parent_id ? state.categoriesById.get(chan.parent_id) : undefined;
    let chanType: "text" | "voice" | "announcement" | "forum" = "text";
    if (chan.type === ChannelType.GUILD_VOICE) chanType = "voice";
    else if (chan.type === ChannelType.GUILD_ANNOUNCEMENT) chanType = "announcement";
    else if (chan.type === ChannelType.GUILD_FORUM) chanType = "forum";

    const chanConfig: ChannelConfig = {
      name: chan.name ?? "unnamed-channel",
      type: chanType,
      ...(options.includeIds ? { discord_id: chan.id } : {}),
    };

    if (parentCat?.name) {
      chanConfig.category = parentCat.name;
    }
    if (chan.topic) {
      chanConfig.topic = chan.topic;
    }
    if (chan.position !== undefined) {
      chanConfig.position = chan.position;
    }
    if (chan.rate_limit_per_user && chan.rate_limit_per_user > 0) {
      chanConfig.slowmode = chan.rate_limit_per_user;
    }

    channels.push(chanConfig);
  }

  // 4. Permission Overwrites (Categories and Channels)
  const allTargetChannels = [...state.categories, ...state.channels];

  for (const target of allTargetChannels) {
    if (!target.permission_overwrites || target.permission_overwrites.length === 0) {
      continue;
    }

    const targetName = target.name;
    if (!targetName) continue;

    const targetPermMap: Record<string, Record<string, boolean>> = {};

    for (const overwrite of target.permission_overwrites) {
      // Only export role overwrites (type 0)
      if (overwrite.type !== 0) continue;

      let roleName: string | undefined;
      if (overwrite.id === state.guild.id) {
        roleName = "@everyone";
      } else {
        roleName = state.rolesById.get(overwrite.id)?.name;
      }

      if (!roleName) continue;

      const permMap = overwritesToPermissionMap(overwrite.allow, overwrite.deny);
      if (Object.keys(permMap).length > 0) {
        targetPermMap[roleName] = permMap;
      }
    }

    if (Object.keys(targetPermMap).length > 0) {
      permissions[targetName] = targetPermMap;
    }
  }

  return {
    roles,
    categories,
    channels,
    permissions,
  };
}

/**
 * Export Discord configuration to disk in YAML files.
 */
export function writeExportFiles(
  config: DiscordConfig,
  options: ExportOptions = {},
): { filesWritten: string[] } {
  const targetDir = options.outputDir ?? "discord-export";
  mkdirSync(targetDir, { recursive: true });

  const filesWritten: string[] = [];

  if (options.singleFile) {
    const filePath = join(targetDir, "discord.yaml");
    writeFileSync(filePath, stringifyYaml(config, { indent: 2 }), "utf-8");
    filesWritten.push(filePath);
    return { filesWritten };
  }

  // Multi-file export
  if (config.roles && config.roles.length > 0) {
    const rolesFile = join(targetDir, "roles.yaml");
    writeFileSync(rolesFile, stringifyYaml({ roles: config.roles }, { indent: 2 }), "utf-8");
    filesWritten.push(rolesFile);
  }

  if (config.categories && config.categories.length > 0) {
    const catFile = join(targetDir, "categories.yaml");
    writeFileSync(
      catFile,
      stringifyYaml({ categories: config.categories }, { indent: 2 }),
      "utf-8",
    );
    filesWritten.push(catFile);
  }

  if (config.channels && config.channels.length > 0) {
    const chanFile = join(targetDir, "channels.yaml");
    writeFileSync(chanFile, stringifyYaml({ channels: config.channels }, { indent: 2 }), "utf-8");
    filesWritten.push(chanFile);
  }

  if (config.permissions && Object.keys(config.permissions).length > 0) {
    const permFile = join(targetDir, "permissions.yaml");
    writeFileSync(
      permFile,
      stringifyYaml({ permissions: config.permissions }, { indent: 2 }),
      "utf-8",
    );
    filesWritten.push(permFile);
  }

  return { filesWritten };
}
