import { parseColorToNumber } from "../config/schema.js";
import type { DiscordConfig } from "../config/types.js";
import {
  overwritesToPermissionMap,
  permissionMapToOverwrites,
  permissionsToBitfield,
} from "../discord/permissions.js";
import type { DiscordServerState } from "../discord/state.js";
import { format, symbols } from "../utils/format.js";

export interface DriftItem {
  resourceType: "role" | "category" | "channel" | "permission";
  resourceName: string;
  field: string;
  desired: unknown;
  actual: unknown;
}

export interface VerificationResult {
  inSync: boolean;
  rolesInSync: boolean;
  categoriesInSync: boolean;
  channelsInSync: boolean;
  permissionsInSync: boolean;
  drift: DriftItem[];
}

/**
 * Verify whether current Discord state matches desired declarative configuration.
 * Purely side-effect free.
 */
export function verifyState(
  desired: DiscordConfig,
  current: DiscordServerState,
): VerificationResult {
  const drift: DriftItem[] = [];

  let rolesInSync = true;
  let categoriesInSync = true;
  let channelsInSync = true;
  let permissionsInSync = true;

  // 1. Verify Roles
  for (const role of desired.roles ?? []) {
    const existing =
      (role.discord_id ? current.rolesById.get(role.discord_id) : undefined) ??
      current.rolesByName.get(role.name.toLowerCase());

    if (!existing) {
      rolesInSync = false;
      drift.push({
        resourceType: "role",
        resourceName: role.name,
        field: "existence",
        desired: "present",
        actual: "missing",
      });
      continue;
    }

    const desiredColor = parseColorToNumber(role.color);
    if (desiredColor !== undefined && existing.color !== desiredColor) {
      rolesInSync = false;
      drift.push({
        resourceType: "role",
        resourceName: role.name,
        field: "color",
        desired: role.color,
        actual: existing.color,
      });
    }

    if (role.hoist !== undefined && existing.hoist !== role.hoist) {
      rolesInSync = false;
      drift.push({
        resourceType: "role",
        resourceName: role.name,
        field: "hoist",
        desired: role.hoist,
        actual: existing.hoist,
      });
    }

    if (role.mentionable !== undefined && existing.mentionable !== role.mentionable) {
      rolesInSync = false;
      drift.push({
        resourceType: "role",
        resourceName: role.name,
        field: "mentionable",
        desired: role.mentionable,
        actual: existing.mentionable,
      });
    }

    if (role.permissions !== undefined) {
      const desiredBitfield = permissionsToBitfield(role.permissions);
      if (existing.permissions !== desiredBitfield) {
        rolesInSync = false;
        drift.push({
          resourceType: "role",
          resourceName: role.name,
          field: "permissions",
          desired: role.permissions,
          actual: existing.permissions,
        });
      }
    }
  }

  // 2. Verify Categories
  for (const cat of desired.categories ?? []) {
    const existing =
      (cat.discord_id ? current.categoriesById.get(cat.discord_id) : undefined) ??
      current.categoriesByName.get(cat.name.toLowerCase());

    if (!existing) {
      categoriesInSync = false;
      drift.push({
        resourceType: "category",
        resourceName: cat.name,
        field: "existence",
        desired: "present",
        actual: "missing",
      });
      continue;
    }

    if (cat.position !== undefined && existing.position !== cat.position) {
      categoriesInSync = false;
      drift.push({
        resourceType: "category",
        resourceName: cat.name,
        field: "position",
        desired: cat.position,
        actual: existing.position,
      });
    }
  }

  // 3. Verify Channels
  for (const chan of desired.channels ?? []) {
    let existing = chan.discord_id ? current.channelsById.get(chan.discord_id) : undefined;
    if (!existing) {
      const candidates = current.channelsByName.get(chan.name.toLowerCase()) ?? [];
      for (const cand of candidates) {
        const candParent = cand.parent_id
          ? current.categoriesById.get(cand.parent_id)?.name?.toLowerCase()
          : undefined;
        if (chan.category) {
          if (candParent === chan.category.toLowerCase()) {
            existing = cand;
            break;
          }
        } else if (!cand.parent_id) {
          existing = cand;
          break;
        }
      }
      if (!existing && candidates.length === 1 && chan.category) {
        existing = candidates[0];
      }
    }

    if (!existing) {
      channelsInSync = false;
      drift.push({
        resourceType: "channel",
        resourceName: `#${chan.name}`,
        field: "existence",
        desired: "present",
        actual: "missing",
      });
      continue;
    }

    const actualParent = existing.parent_id
      ? current.categoriesById.get(existing.parent_id)?.name
      : undefined;

    if (
      chan.category &&
      actualParent?.toLowerCase() !== chan.category.toLowerCase()
    ) {
      channelsInSync = false;
      drift.push({
        resourceType: "channel",
        resourceName: `#${chan.name}`,
        field: "category",
        desired: chan.category,
        actual: actualParent ?? "None",
      });
    }

    if (chan.topic !== undefined && (existing.topic ?? "") !== chan.topic) {
      channelsInSync = false;
      drift.push({
        resourceType: "channel",
        resourceName: `#${chan.name}`,
        field: "topic",
        desired: chan.topic,
        actual: existing.topic ?? "",
      });
    }

    if (chan.position !== undefined && existing.position !== chan.position) {
      channelsInSync = false;
      drift.push({
        resourceType: "channel",
        resourceName: `#${chan.name}`,
        field: "position",
        desired: chan.position,
        actual: existing.position,
      });
    }

    if (
      chan.slowmode !== undefined &&
      existing.rate_limit_per_user !== chan.slowmode
    ) {
      channelsInSync = false;
      drift.push({
        resourceType: "channel",
        resourceName: `#${chan.name}`,
        field: "slowmode",
        desired: chan.slowmode,
        actual: existing.rate_limit_per_user ?? 0,
      });
    }
  }

  // 4. Verify Permissions
  if (desired.permissions) {
    for (const [targetName, rolePermMap] of Object.entries(desired.permissions)) {
      const targetCat = current.categoriesByName.get(targetName.toLowerCase());
      const targetChan = current.channelsByName.get(targetName.toLowerCase())?.[0];
      const target = targetCat ?? targetChan;

      if (!target) {
        permissionsInSync = false;
        drift.push({
          resourceType: "permission",
          resourceName: targetName,
          field: "target",
          desired: "present",
          actual: "missing",
        });
        continue;
      }

      for (const [roleName, perms] of Object.entries(rolePermMap)) {
        let roleId = roleName === "@everyone" ? current.guild.id : undefined;
        if (!roleId) {
          roleId = current.rolesByName.get(roleName.toLowerCase())?.id;
        }

        const overwrite = target.permission_overwrites?.find((ow) => ow.id === roleId);
        if (!overwrite) {
          permissionsInSync = false;
          drift.push({
            resourceType: "permission",
            resourceName: `${targetName} [${roleName}]`,
            field: "overwrite",
            desired: "present",
            actual: "missing",
          });
          continue;
        }

        const actualPermMap = overwritesToPermissionMap(overwrite.allow, overwrite.deny);
        const { allow: desiredAllow, deny: desiredDeny } = permissionMapToOverwrites(perms);

        if (overwrite.allow !== desiredAllow || overwrite.deny !== desiredDeny) {
          for (const [permKey, desiredVal] of Object.entries(perms)) {
            if (actualPermMap[permKey] !== desiredVal) {
              permissionsInSync = false;
              drift.push({
                resourceType: "permission",
                resourceName: `${targetName} [${roleName}]`,
                field: permKey,
                desired: desiredVal,
                actual: actualPermMap[permKey] ?? "neutral",
              });
            }
          }
        }
      }
    }
  }

  const inSync =
    rolesInSync && categoriesInSync && channelsInSync && permissionsInSync && drift.length === 0;

  return {
    inSync,
    rolesInSync,
    categoriesInSync,
    channelsInSync,
    permissionsInSync,
    drift,
  };
}

/**
 * Format verification report as human-readable CLI output.
 */
export function formatVerificationOutput(result: VerificationResult): string {
  const lines: string[] = [];

  lines.push(format.bold("Discord verification\n"));

  lines.push(
    `  ${result.rolesInSync ? symbols.success : symbols.failure} Roles`,
    `  ${result.categoriesInSync ? symbols.success : symbols.failure} Categories`,
    `  ${result.channelsInSync ? symbols.success : symbols.failure} Channels`,
    `  ${result.permissionsInSync ? symbols.success : symbols.failure} Permissions`,
  );

  if (result.inSync) {
    lines.push(format.success("\nAll resources match the desired configuration! (0 drift)"));
  } else {
    lines.push(format.error(`\nDrift detected (${result.drift.length} discrepancies):\n`));

    // Group drift by resourceName
    const grouped = new Map<string, DriftItem[]>();
    for (const item of result.drift) {
      const items = grouped.get(item.resourceName) ?? [];
      items.push(item);
      grouped.set(item.resourceName, items);
    }

    for (const [name, items] of grouped) {
      lines.push(`  ${format.bold(name)}`);
      for (const item of items) {
        lines.push(
          `    desired ${item.field}: ${JSON.stringify(item.desired)}`,
          `    actual ${item.field}:  ${JSON.stringify(item.actual)}`,
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
