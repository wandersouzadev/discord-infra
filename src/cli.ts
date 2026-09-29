#!/usr/bin/env bun
import { Command } from "commander";
import { loadConfig } from "./config/loader.js";
import { DiscordRestClient } from "./discord/client.js";
import { fetchDiscordState } from "./discord/state.js";
import { executePlan, formatExecutionResult } from "./executor/executor.js";
import { exportStateToConfig, writeExportFiles } from "./exporter/exporter.js";
import { formatPlanJson, formatPlanOutput, generatePlan } from "./planner/planner.js";
import { formatVerificationOutput, verifyState } from "./verifier/verifier.js";
import { ConfirmationAbortedError, DiscordInfraError } from "./utils/errors.js";
import { format, symbols } from "./utils/format.js";
import { logger } from "./utils/logger.js";

const program = new Command();

program
  .name("discord-infra")
  .description("Declarative Discord Infrastructure as Code Manager")
  .version("1.0.0");

function getGuildId(options: { guild?: string }): string {
  const guildId = options.guild ?? process.env.DISCORD_GUILD_ID;
  if (!guildId) {
    throw new DiscordInfraError(
      "Discord Guild ID is required. Set DISCORD_GUILD_ID in your environment or pass --guild <id>.",
    );
  }
  return guildId;
}

// ----------------------------------------------------
// Command: validate
// ----------------------------------------------------
program
  .command("validate")
  .description("Validate local YAML configuration files and referential integrity")
  .option("-c, --config <path>", "Path to YAML configuration directory or file")
  .option("--json", "Output results in JSON format")
  .action((options) => {
    try {
      const config = loadConfig({ configPath: options.config });
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              valid: true,
              rolesCount: config.roles?.length ?? 0,
              categoriesCount: config.categories?.length ?? 0,
              channelsCount: config.channels?.length ?? 0,
              permissionsTargetsCount: Object.keys(config.permissions ?? {}).length,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(format.success("✓ Configuration is valid and passes all integrity checks."));
        console.log(
          format.dim(
            `  Roles: ${config.roles?.length ?? 0} | ` +
              `Categories: ${config.categories?.length ?? 0} | ` +
              `Channels: ${config.channels?.length ?? 0} | ` +
              `Permission Targets: ${Object.keys(config.permissions ?? {}).length}`,
          ),
        );
      }
    } catch (err) {
      if (options.json) {
        console.error(
          JSON.stringify(
            {
              valid: false,
              error: (err as Error).message,
            },
            null,
            2,
          ),
        );
      } else {
        console.error(format.error(`Configuration validation failed:`));
        console.error((err as Error).message);
      }
      process.exit(1);
    }
  });

// ----------------------------------------------------
// Command: plan
// ----------------------------------------------------
program
  .command("plan")
  .description("Compute diff between desired state and Discord server and display the plan")
  .option("-c, --config <path>", "Path to YAML configuration directory or file")
  .option("-g, --guild <id>", "Discord Guild ID")
  .option("--json", "Output execution plan in JSON format")
  .option("-v, --verbose", "Enable verbose debug logs")
  .action(async (options) => {
    if (options.verbose) {
      logger.setLevel("debug");
    }

    try {
      const guildId = getGuildId(options);
      const desired = loadConfig({ configPath: options.config });
      const client = new DiscordRestClient();
      const state = await fetchDiscordState(client, guildId);

      const planResult = generatePlan(desired, state);

      if (options.json) {
        console.log(formatPlanJson(planResult));
      } else {
        console.log(formatPlanOutput(planResult));
      }
    } catch (err) {
      if (options.json) {
        console.error(
          JSON.stringify({ error: (err as Error).message }, null, 2),
        );
      } else {
        console.error(format.error(`Plan failed:`));
        console.error((err as Error).message);
      }
      process.exit(1);
    }
  });

// ----------------------------------------------------
// Command: apply
// ----------------------------------------------------
program
  .command("apply")
  .description("Apply declarative configuration changes to Discord")
  .option("-c, --config <path>", "Path to YAML configuration directory or file")
  .option("-g, --guild <id>", "Discord Guild ID")
  .option("-y, --yes", "Automatically approve non-destructive changes")
  .option("--allow-destructive", "Permit destructive operations (resource deletions)")
  .option("--non-interactive", "Run in non-interactive CI mode")
  .option("--dry-run", "Simulate operations without calling Discord API")
  .option("--json", "Output execution results in JSON format")
  .option("-v, --verbose", "Enable verbose debug logs")
  .action(async (options) => {
    if (options.verbose) {
      logger.setLevel("debug");
    }

    try {
      const guildId = getGuildId(options);
      const desired = loadConfig({ configPath: options.config });
      const client = new DiscordRestClient();
      const state = await fetchDiscordState(client, guildId);

      const planResult = generatePlan(desired, state);

      if (!options.json) {
        console.log(formatPlanOutput(planResult));
      }

      if (planResult.operations.length === 0) {
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                success: true,
                message: "No operations required. Infrastructure is in sync.",
                applied: 0,
              },
              null,
              2,
            ),
          );
        }
        return;
      }

      const execution = await executePlan(planResult, client, {
        interactive: !options.nonInteractive,
        allowDestructive: options.allowDestructive,
        autoApprove: options.yes,
        dryRun: options.dryRun,
      });

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: execution.success,
              totalOperations: execution.totalOperations,
              completedCount: execution.completed.length,
              completed: execution.completed.map((c) => ({
                action: c.operation.type,
                resource: c.operation.resourceName,
                durationMs: c.durationMs,
              })),
              failed: execution.failed
                ? {
                    action: execution.failed.operation.type,
                    resource: execution.failed.operation.resourceName,
                    error: execution.failed.error,
                  }
                : undefined,
              unexecutedCount: execution.unexecuted.length,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(formatExecutionResult(execution));
      }

      if (!execution.success) {
        process.exit(1);
      }

      // Verify server state after apply
      if (!options.dryRun && execution.success) {
        const freshState = await fetchDiscordState(client, guildId);
        const verification = verifyState(desired, freshState);
        if (!options.json) {
          console.log("\nPost-apply Verification:");
          console.log(formatVerificationOutput(verification));
        }
        if (!verification.inSync) {
          process.exit(1);
        }
      }
    } catch (err) {
      if (err instanceof ConfirmationAbortedError) {
        console.log(format.dim(`\n${err.message}`));
        process.exit(130);
      }

      if (options.json) {
        console.error(
          JSON.stringify({ error: (err as Error).message }, null, 2),
        );
      } else {
        console.error(format.error(`\nApply failed:`));
        console.error((err as Error).message);
      }
      process.exit(1);
    }
  });

// ----------------------------------------------------
// Command: verify
// ----------------------------------------------------
program
  .command("verify")
  .description("Check for drift between current Discord state and desired configuration")
  .option("-c, --config <path>", "Path to YAML configuration directory or file")
  .option("-g, --guild <id>", "Discord Guild ID")
  .option("--json", "Output drift report in JSON format")
  .option("-v, --verbose", "Enable verbose debug logs")
  .action(async (options) => {
    if (options.verbose) {
      logger.setLevel("debug");
    }

    try {
      const guildId = getGuildId(options);
      const desired = loadConfig({ configPath: options.config });
      const client = new DiscordRestClient();
      const state = await fetchDiscordState(client, guildId);

      const result = verifyState(desired, state);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatVerificationOutput(result));
      }

      if (!result.inSync) {
        process.exit(1);
      }
    } catch (err) {
      if (options.json) {
        console.error(
          JSON.stringify({ error: (err as Error).message }, null, 2),
        );
      } else {
        console.error(format.error(`Verify failed:`));
        console.error((err as Error).message);
      }
      process.exit(1);
    }
  });

// ----------------------------------------------------
// Command: export
// ----------------------------------------------------
program
  .command("export")
  .description("Export existing Discord server configuration to declarative YAML")
  .option("-o, --output <dir>", "Output directory for exported YAML files", "discord-export")
  .option("-g, --guild <id>", "Discord Guild ID")
  .option("--single-file", "Export everything into a single discord.yaml file")
  .option("--json", "Output export summary in JSON format")
  .option("-v, --verbose", "Enable verbose debug logs")
  .action(async (options) => {
    if (options.verbose) {
      logger.setLevel("debug");
    }

    try {
      const guildId = getGuildId(options);
      const client = new DiscordRestClient();
      const state = await fetchDiscordState(client, guildId);

      const config = exportStateToConfig(state);
      const { filesWritten } = writeExportFiles(config, {
        outputDir: options.output,
        singleFile: options.singleFile,
      });

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              outputDir: options.output,
              filesWritten,
              rolesCount: config.roles?.length ?? 0,
              categoriesCount: config.categories?.length ?? 0,
              channelsCount: config.channels?.length ?? 0,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(format.success("\nExport completed successfully!"));
        console.log(`Generated declarative configuration in: ${format.bold(options.output)}\n`);
        for (const file of filesWritten) {
          console.log(`  ${symbols.bullet} ${file}`);
        }
        console.log(
          format.dim(
            `\nExported ${config.roles?.length ?? 0} roles, ` +
              `${config.categories?.length ?? 0} categories, ` +
              `and ${config.channels?.length ?? 0} channels.`,
          ),
        );
      }
    } catch (err) {
      if (options.json) {
        console.error(
          JSON.stringify({ error: (err as Error).message }, null, 2),
        );
      } else {
        console.error(format.error(`Export failed:`));
        console.error((err as Error).message);
      }
      process.exit(1);
    }
  });

program.parse(process.argv);
