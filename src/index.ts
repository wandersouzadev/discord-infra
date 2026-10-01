import { loadConfig } from "./config/loader.js";
import type { DiscordConfig } from "./config/types.js";
import { DiscordRestClient, type DiscordClientOptions } from "./discord/client.js";
import { fetchDiscordState, type DiscordServerState } from "./discord/state.js";
import { executePlan } from "./executor/executor.js";
import type { ExecutionResult, ExecutorOptions } from "./executor/types.js";
import { exportStateToConfig, writeExportFiles, type ExportOptions } from "./exporter/exporter.js";
import { generatePlan } from "./planner/planner.js";
import type { Plan } from "./planner/types.js";
import { verifyState, type VerificationResult } from "./verifier/verifier.js";

export * from "./config/types.js";
export * from "./config/schema.js";
export * from "./config/loader.js";
export * from "./discord/types.js";
export * from "./discord/permissions.js";
export * from "./discord/hierarchy.js";
export * from "./discord/client.js";
export * from "./discord/state.js";
export * from "./planner/types.js";
export * from "./planner/planner.js";
export * from "./executor/types.js";
export * from "./executor/executor.js";
export * from "./verifier/verifier.js";
export * from "./exporter/exporter.js";
export * from "./wiper/wiper.js";
export * from "./utils/errors.js";
export * from "./utils/logger.js";
export * from "./utils/format.js";

export interface ProgrammaticOptions {
  guildId?: string;
  configPath?: string;
  clientOptions?: DiscordClientOptions;
}

/**
 * Validate configuration files locally without connecting to Discord.
 */
export function validate(options: { configPath?: string } = {}): {
  valid: boolean;
  config: DiscordConfig;
} {
  const config = loadConfig({ configPath: options.configPath });
  return { valid: true, config };
}

/**
 * Fetch full Discord server state.
 */
export async function getState(options: ProgrammaticOptions = {}): Promise<DiscordServerState> {
  const guildId = options.guildId ?? process.env.DISCORD_GUILD_ID;
  if (!guildId) {
    throw new Error("DISCORD_GUILD_ID is required.");
  }
  const client = new DiscordRestClient(options.clientOptions);
  return fetchDiscordState(client, guildId);
}

/**
 * Generate an infrastructure execution plan.
 */
export async function plan(
  options: ProgrammaticOptions = {},
): Promise<{ plan: Plan; config: DiscordConfig; state: DiscordServerState }> {
  const desired = loadConfig({ configPath: options.configPath });
  const state = await getState(options);
  const planResult = generatePlan(desired, state);
  return { plan: planResult, config: desired, state };
}

/**
 * Apply the declarative infrastructure changes to Discord.
 */
export async function apply(options: ProgrammaticOptions & ExecutorOptions = {}): Promise<{
  plan: Plan;
  execution: ExecutionResult;
  verification?: VerificationResult;
}> {
  const { plan: planResult } = await plan(options);
  const client = new DiscordRestClient(options.clientOptions);
  const execution = await executePlan(planResult, client, options);

  let verification: VerificationResult | undefined;
  if (execution.success && !options.dryRun) {
    const freshState = await getState(options);
    const desired = loadConfig({ configPath: options.configPath });
    verification = verifyState(desired, freshState);
  }

  return { plan: planResult, execution, verification };
}

/**
 * Verify current Discord server state against desired declarative configuration.
 */
export async function verify(
  options: ProgrammaticOptions = {},
): Promise<{ verification: VerificationResult; state: DiscordServerState }> {
  const desired = loadConfig({ configPath: options.configPath });
  const state = await getState(options);
  const verification = verifyState(desired, state);
  return { verification, state };
}

/**
 * Export current Discord state to declarative YAML files.
 */
export async function exportInfrastructure(
  options: ProgrammaticOptions & ExportOptions = {},
): Promise<{
  config: DiscordConfig;
  filesWritten: string[];
}> {
  const state = await getState(options);
  const config = exportStateToConfig(state);
  const { filesWritten } = writeExportFiles(config, options);
  return { config, filesWritten };
}
