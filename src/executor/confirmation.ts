import * as readline from "node:readline";
import type { Plan } from "../planner/types.js";
import { ConfirmationAbortedError, SafetyError } from "../utils/errors.js";
import { format } from "../utils/format.js";
import type { ExecutorOptions } from "./types.js";

/**
 * Ask a prompt question to stdin asynchronously.
 */
export async function askQuestion(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Request user confirmation before applying a plan.
 * Checks for destructive operations and handles interactive vs CI flags safely.
 */
export async function confirmPlanExecution(
  plan: Plan,
  options: ExecutorOptions = {},
): Promise<void> {
  const hasDestructive = plan.summary.destructive > 0;
  const isInteractive = options.interactive !== false && Boolean(process.stdin.isTTY);

  // Destructive operations check
  if (hasDestructive) {
    if (!options.allowDestructive) {
      throw new SafetyError(
        `Plan contains ${plan.summary.destructive} destructive operation(s) (deletions). ` +
          `To proceed, you must specify the '--allow-destructive' flag.`,
      );
    }

    if (!isInteractive) {
      // In CI / non-interactive environment, require both --allow-destructive and --yes
      if (!options.autoApprove) {
        throw new SafetyError(
          `Destructive operations detected in non-interactive environment. ` +
            `Both '--allow-destructive' and '--yes' must be provided for automated execution.`,
        );
      }
      return;
    }

    // In interactive environment, even with --allow-destructive, require typing "DELETE" unless --yes was given
    if (!options.autoApprove) {
      console.log(
        format.error(
          `\nWARNING: This plan contains ${plan.summary.destructive} DESTRUCTIVE operation(s)!`,
        ),
      );
      const answer = await askQuestion(
        format.bold('Type "DELETE" to confirm destructive changes: '),
      );

      if (answer !== "DELETE") {
        throw new ConfirmationAbortedError('Confirmation rejected. Did not receive "DELETE".');
      }
    }
    return;
  }

  // Non-destructive operations check
  if (options.autoApprove) {
    return;
  }

  if (!isInteractive) {
    throw new SafetyError(
      "Non-interactive environment detected. Use '--yes' to approve changes automatically.",
    );
  }

  const answer = await askQuestion(format.bold("\nContinue? [y/N]: "));
  const normalized = answer.trim().toLowerCase();

  if (normalized !== "y" && normalized !== "yes") {
    throw new ConfirmationAbortedError("Execution cancelled by user.");
  }
}
