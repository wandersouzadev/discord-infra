import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { ConfigValidationError } from "../utils/errors.js";
import { DiscordConfigSchema, validateReferentialIntegrity } from "./schema.js";
import type { DiscordConfig } from "./types.js";

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

  return validateAndNormalizeConfig(raw, options);
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

  if (permissionsYaml) {
    if (typeof permissionsYaml === "object" && "permissions" in permissionsYaml) {
      merged.permissions = (permissionsYaml as { permissions: unknown }).permissions;
    } else if (typeof permissionsYaml === "object") {
      merged.permissions = permissionsYaml;
    }
  }

  return validateAndNormalizeConfig(merged, options);
}

function validateAndNormalizeConfig(raw: unknown, options: LoadConfigOptions): DiscordConfig {
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
    validateReferentialIntegrity(parsedConfig);
  }

  return parsedConfig;
}
