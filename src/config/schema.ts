import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { isValidPermission, normalizePermissionName } from "../discord/permissions.js";
import { ConfigValidationError } from "../utils/errors.js";
import type { DiscordConfig } from "./types.js";

/**
 * Parse hex string (e.g. "#9B59B6", "9B59B6") or numeric color to number.
 */
export function parseColorToNumber(color?: string | number): number | undefined {
  if (color === undefined || color === null) return undefined;
  if (typeof color === "number") return color;
  const cleaned = color.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    throw new Error(`Invalid hex color: "${color}". Must be 6 hex characters (e.g. "#9B59B6")`);
  }
  return Number.parseInt(cleaned, 16);
}

/**
 * Convert integer color code to hex string "#RRGGBB".
 */
export function numberToHexColor(color?: number): string | undefined {
  if (color === undefined || color === null || color === 0) return undefined;
  return `#${color.toString(16).padStart(6, "0").toUpperCase()}`;
}

export const RoleSchema = z.object({
  name: z
    .string()
    .min(1, "Role name cannot be empty")
    .max(100, "Role name cannot exceed 100 characters"),
  discord_id: z.string().optional(),
  color: z
    .union([z.string(), z.number()])
    .optional()
    .refine(
      (val) => {
        if (val === undefined || val === null) return true;
        try {
          parseColorToNumber(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Color must be a valid 6-character hex string (e.g. '#9B59B6') or integer" },
    ),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  permissions: z
    .array(z.string())
    .optional()
    .refine(
      (perms) => {
        if (!perms) return true;
        return perms.every((p) => isValidPermission(p));
      },
      {
        message:
          "One or more role permissions are invalid. Ensure standard Discord permission names are used.",
      },
    ),
});

export const CategorySchema = z.object({
  name: z
    .string()
    .min(1, "Category name cannot be empty")
    .max(100, "Category name cannot exceed 100 characters"),
  discord_id: z.string().optional(),
  position: z.number().int().min(0).optional(),
});

export const ChannelTypeSchema = z.enum(["text", "voice", "announcement", "forum"]);

export const ChannelSchema = z.object({
  name: z
    .string()
    .min(1, "Channel name cannot be empty")
    .max(100, "Channel name cannot exceed 100 characters"),
  discord_id: z.string().optional(),
  category: z.string().optional(),
  type: ChannelTypeSchema.default("text"),
  topic: z.string().max(1024, "Topic cannot exceed 1024 characters").optional(),
  position: z.number().int().min(0).optional(),
  slowmode: z
    .number()
    .int()
    .min(0)
    .max(21600, "Slowmode cannot exceed 21600 seconds (6 hours)")
    .optional(),
  permissions: z
    .record(
      z.string(), // Role name
      z.record(z.string(), z.boolean()), // Permission name -> boolean
    )
    .optional(),
});

export const PermissionsMapSchema = z.record(
  z.string(), // Target name (Category or Channel)
  z.record(
    z.string(), // Role name or @everyone
    z.record(z.string(), z.boolean()), // Permission flag -> boolean
  ),
);

export const EmojiSchema = z.object({
  name: z
    .string()
    .min(2, "Emoji name must be at least 2 characters")
    .max(32, "Emoji name cannot exceed 32 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Emoji name must contain only alphanumeric characters and underscores (no spaces or hyphens)",
    ),
  discord_id: z.string().optional(),
  file: z.string().optional(),
  image: z.string().optional(),
  roles: z.array(z.string()).optional(),
  animated: z.boolean().optional(),
});

export const DiscordConfigSchema = z.object({
  roles: z.array(RoleSchema).optional().default([]),
  categories: z.array(CategorySchema).optional().default([]),
  channels: z.array(ChannelSchema).optional().default([]),
  emojis: z.array(EmojiSchema).optional().default([]),
  permissions: PermissionsMapSchema.optional().default({}),
});

/**
 * Perform comprehensive semantic validation:
 * - Duplicate names
 * - Broken category references in channels
 * - Broken role references in permissions
 * - Broken target references in permissions
 * - Invalid permission names in overwrites
 */
export function validateReferentialIntegrity(config: DiscordConfig, configDir?: string): void {
  const errors: string[] = [];

  // Check duplicate role names
  const roleNames = new Set<string>();
  for (const role of config.roles ?? []) {
    const lower = role.name.toLowerCase();
    if (roleNames.has(lower)) {
      errors.push(`Duplicate role name detected: "${role.name}". Roles must have unique names.`);
    }
    roleNames.add(lower);
  }

  // Check duplicate category names
  const categoryNames = new Set<string>();
  for (const cat of config.categories ?? []) {
    const lower = cat.name.toLowerCase();
    if (categoryNames.has(lower)) {
      errors.push(
        `Duplicate category name detected: "${cat.name}". Categories must have unique names.`,
      );
    }
    categoryNames.add(lower);
  }

  // Check duplicate channel names within the same category
  const channelKeys = new Set<string>();
  for (const chan of config.channels ?? []) {
    const catKey = (chan.category ?? "__root__").toLowerCase();
    const chanKey = `${catKey}:${chan.name.toLowerCase()}`;
    if (channelKeys.has(chanKey)) {
      errors.push(
        `Duplicate channel name "${chan.name}" detected in category "${chan.category ?? "None"}". Channels in the same category must have unique names.`,
      );
    }
    channelKeys.add(chanKey);

    // Verify channel references an existing category
    if (chan.category) {
      if (!categoryNames.has(chan.category.toLowerCase())) {
        errors.push(
          `Channel "${chan.name}" references non-existent category "${chan.category}". Available categories: ${Array.from(categoryNames).join(", ") || "none"}.`,
        );
      }
    }

    // Check channel-level inline permissions
    if (chan.permissions) {
      for (const [roleName, perms] of Object.entries(chan.permissions)) {
        if (roleName !== "@everyone" && !roleNames.has(roleName.toLowerCase())) {
          errors.push(
            `Channel "${chan.name}" has inline permissions for unknown role "${roleName}".`,
          );
        }
        for (const permKey of Object.keys(perms)) {
          if (!isValidPermission(permKey)) {
            errors.push(`Channel "${chan.name}" references unknown permission flag: "${permKey}".`);
          }
        }
      }
    }
  }

  // Check global permissions map
  if (config.permissions) {
    const channelNames = new Set((config.channels ?? []).map((c) => c.name.toLowerCase()));

    for (const [targetName, rolePermMap] of Object.entries(config.permissions)) {
      const lowerTarget = targetName.toLowerCase();
      const isCategory = categoryNames.has(lowerTarget);
      const isChannel = channelNames.has(lowerTarget);
      const isRole = roleNames.has(lowerTarget);

      if (!isCategory && !isChannel && !isRole) {
        errors.push(
          `Permission target "${targetName}" not found. It must match a defined category, channel, or role.`,
        );
      }

      for (const [roleName, permMap] of Object.entries(rolePermMap)) {
        if (roleName !== "@everyone" && !roleNames.has(roleName.toLowerCase())) {
          errors.push(
            `Permission section for "${targetName}" references unknown role "${roleName}".`,
          );
        }

        for (const permName of Object.keys(permMap)) {
          if (!isValidPermission(normalizePermissionName(permName))) {
            errors.push(
              `Permission section for "${targetName}" -> "${roleName}" has unknown permission: "${permName}".`,
            );
          }
        }
      }
    }
  }

  // Check emojis
  const emojiNames = new Set<string>();
  for (const emoji of config.emojis ?? []) {
    const lower = emoji.name.toLowerCase();
    if (emojiNames.has(lower)) {
      errors.push(`Duplicate emoji name detected: "${emoji.name}". Emojis must have unique names.`);
    }
    emojiNames.add(lower);

    // Verify role references in emoji
    if (emoji.roles) {
      for (const roleName of emoji.roles) {
        if (!roleNames.has(roleName.toLowerCase())) {
          errors.push(
            `Emoji "${emoji.name}" references non-existent role "${roleName}". Available roles: ${Array.from(roleNames).join(", ") || "none"}.`,
          );
        }
      }
    }

    // Verify image file existence and size if a file or local image path is given
    const filePath =
      emoji.file ??
      (emoji.image && !emoji.image.startsWith("data:image/") ? emoji.image : undefined);
    if (filePath && configDir) {
      const resolved = resolve(configDir, filePath);
      const cwdResolved = resolve(filePath);
      if (!existsSync(resolved) && !existsSync(cwdResolved)) {
        errors.push(
          `Emoji "${emoji.name}" image file not found: "${filePath}" (searched in "${resolved}")`,
        );
      } else {
        const actualPath = existsSync(resolved) ? resolved : cwdResolved;
        try {
          const stats = statSync(actualPath);
          if (stats.size > 256 * 1024) {
            errors.push(
              `Emoji "${emoji.name}" file size (${(stats.size / 1024).toFixed(1)} KB) exceeds Discord 256 KB limit: "${filePath}"`,
            );
          }
        } catch {
          // Ignore stat error if unable to read
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(
      `Configuration integrity check failed with ${errors.length} error(s):\n  - ${errors.join("\n  - ")}`,
      errors,
    );
  }
}
