import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { ConfigValidationError } from "../utils/errors.js";
import { DiscordConfigSchema, validateReferentialIntegrity } from "./schema.js";
import type { DiscordConfig, EmojiConfig } from "./types.js";

export interface LoadConfigOptions {
  configPath?: string;
  skipIntegrityCheck?: boolean;
}

/**
 * Helper to safely read and parse a YAML file if it exists.
 */
function tryReadYaml(filePath: string): unknown {
  if (!existsSync(filePath)) return undefined;
  const content = readFileSync(filePath, "utf-8");
  return parseYaml(content);
}

/**
 * Load and validate Discord declarative configuration from a directory or single file.
 */
export function loadConfig(options: LoadConfigOptions = {}): DiscordConfig {
  const searchPath = resolve(options.configPath ?? "discord");

  if (!existsSync(searchPath)) {
    // Also check single file discord.yaml if default discord dir does not exist
    if (!options.configPath && existsSync(resolve("discord.yaml"))) {
      return loadConfigFile(resolve("discord.yaml"), options);
    }
    if (!options.configPath && existsSync(resolve("discord.yml"))) {
      return loadConfigFile(resolve("discord.yml"), options);
    }
    throw new ConfigValidationError(`Configuration path not found: ${searchPath}`);
  }

  const stat = lstatSync(searchPath);
  if (stat.isFile()) {
    return loadConfigFile(searchPath, options);
  }

  // Load from directory (roles.yaml, categories.yaml, channels.yaml, permissions.yaml)
  return loadConfigDir(searchPath, options);
}

/**
 * Resolve MIME type from file extension.
 */
export function getMimeTypeFromPath(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "png":
    default:
      return "image/png";
  }
}

/**
 * Read an image file from disk and convert it to a Data URI scheme (e.g. data:image/png;base64,...).
 */
export function readImageAsDataUri(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new ConfigValidationError(`Image file not found: ${filePath}`);
  }
  const buffer = readFileSync(filePath);
  if (buffer.length > 256 * 1024) {
    throw new ConfigValidationError(
      `Image file ${filePath} (${(buffer.length / 1024).toFixed(1)} KB) exceeds Discord 256 KB limit.`,
    );
  }
  const mimeType = getMimeTypeFromPath(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Helper to resolve emoji image data URI from an EmojiConfig.
 */
export function resolveEmojiDataUri(
  emoji: EmojiConfig,
  baseDir: string = "discord",
): string | undefined {
  if (emoji.image && emoji.image.startsWith("data:image/")) {
    return emoji.image;
  }
  const targetFile = emoji.file ?? emoji.image;
  if (!targetFile) {
    return undefined;
  }
  const candidatePaths = [
    resolve(baseDir, targetFile),
    resolve(targetFile),
    resolve(baseDir, "emojis", targetFile),
  ];
  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return readImageAsDataUri(candidate);
    }
  }
  throw new ConfigValidationError(
    `Image file for emoji "${emoji.name}" not found. Searched: ${candidatePaths.join(", ")}`,
  );
}

function loadConfigFile(filePath: string, options: LoadConfigOptions): DiscordConfig {
  let raw: unknown;
  try {
    const content = readFileSync(filePath, "utf-8");
    raw = parseYaml(content) ?? {};
  } catch (err) {
    throw new ConfigValidationError(
      `Failed to parse YAML file at ${filePath}: ${(err as Error).message}`,
    );
  }

  return validateAndNormalizeConfig(raw, options, dirname(filePath));
}

function loadConfigDir(dirPath: string, options: LoadConfigOptions): DiscordConfig {
  const rolesYaml =
    tryReadYaml(join(dirPath, "roles.yaml")) ?? tryReadYaml(join(dirPath, "roles.yml"));
  const categoriesYaml =
    tryReadYaml(join(dirPath, "categories.yaml")) ?? tryReadYaml(join(dirPath, "categories.yml"));
  const channelsYaml =
    tryReadYaml(join(dirPath, "channels.yaml")) ?? tryReadYaml(join(dirPath, "channels.yml"));
  const permissionsYaml =
    tryReadYaml(join(dirPath, "permissions.yaml")) ?? tryReadYaml(join(dirPath, "permissions.yml"));
  const emojisYaml =
    tryReadYaml(join(dirPath, "emojis.yaml")) ?? tryReadYaml(join(dirPath, "emojis.yml"));
  const rootYaml =
    tryReadYaml(join(dirPath, "discord.yaml")) ?? tryReadYaml(join(dirPath, "discord.yml"));

  const merged: Record<string, unknown> = {};

  if (rootYaml && typeof rootYaml === "object") {
    Object.assign(merged, rootYaml);
  }

  if (rolesYaml) {
    if (Array.isArray(rolesYaml)) {
      merged.roles = rolesYaml;
    } else if (typeof rolesYaml === "object" && "roles" in rolesYaml) {
      merged.roles = (rolesYaml as { roles: unknown }).roles;
    }
  }

  if (categoriesYaml) {
    if (Array.isArray(categoriesYaml)) {
      merged.categories = categoriesYaml;
    } else if (typeof categoriesYaml === "object" && "categories" in categoriesYaml) {
      merged.categories = (categoriesYaml as { categories: unknown }).categories;
    }
  }

  if (channelsYaml) {
    if (Array.isArray(channelsYaml)) {
      merged.channels = channelsYaml;
    } else if (typeof channelsYaml === "object" && "channels" in channelsYaml) {
      merged.channels = (channelsYaml as { channels: unknown }).channels;
    }
  }

  if (emojisYaml) {
    if (Array.isArray(emojisYaml)) {
      merged.emojis = emojisYaml;
    } else if (typeof emojisYaml === "object" && "emojis" in emojisYaml) {
      merged.emojis = (emojisYaml as { emojis: unknown }).emojis;
    }
  }

  // Auto-discover images inside emojis/ subfolder if present
  const emojisDir = join(dirPath, "emojis");
  if (existsSync(emojisDir) && lstatSync(emojisDir).isDirectory()) {
    const existingEmojiNames = new Set(
      ((merged.emojis as Array<{ name: string }>) ?? []).map((e) => e.name.toLowerCase()),
    );
    const discovered: Array<{ name: string; file: string }> = [];
    const allowedExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
    const files = readdirSync(emojisDir);
    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (!allowedExts.has(ext)) continue;
      const name = basename(file, ext);
      if (!existingEmojiNames.has(name.toLowerCase())) {
        discovered.push({
          name,
          file: `emojis/${file}`,
        });
        existingEmojiNames.add(name.toLowerCase());
      }
    }
    if (discovered.length > 0) {
      merged.emojis = [...((merged.emojis as unknown[]) ?? []), ...discovered];
    }
  }

  if (permissionsYaml) {
    if (typeof permissionsYaml === "object" && "permissions" in permissionsYaml) {
      merged.permissions = (permissionsYaml as { permissions: unknown }).permissions;
    } else if (typeof permissionsYaml === "object") {
      merged.permissions = permissionsYaml;
    }
  }

  return validateAndNormalizeConfig(merged, options, dirPath);
}

function validateAndNormalizeConfig(
  raw: unknown,
  options: LoadConfigOptions,
  configDir?: string,
): DiscordConfig {
  let parsedConfig: DiscordConfig;

  try {
    parsedConfig = DiscordConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map(
        (issue) => `[${issue.path.join(".") || "root"}]: ${issue.message}`,
      );
      throw new ConfigValidationError(
        `Invalid configuration schema (${issues.length} issue(s)):\n  - ${issues.join("\n  - ")}`,
        err.issues,
      );
    }
    throw new ConfigValidationError(`Validation error: ${(err as Error).message}`);
  }

  if (!options.skipIntegrityCheck) {
    validateReferentialIntegrity(parsedConfig, configDir);
  }

  return parsedConfig;
}
