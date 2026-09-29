/**
 * Base error class for all discord-infra errors.
 */
export class DiscordInfraError extends Error {
  constructor(
    message: string,
    public readonly code: string = "DISCORD_INFRA_ERROR",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Configuration validation or syntax error.
 */
export class ConfigValidationError extends DiscordInfraError {
  constructor(message: string, details?: unknown) {
    super(message, "CONFIG_VALIDATION_ERROR", details);
  }
}

/**
 * Discord API error with status code and Discord error response.
 */
export class DiscordApiError extends DiscordInfraError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly discordCode?: number,
    public readonly discordErrors?: unknown,
  ) {
    super(
      `Discord API Error (${status}${discordCode ? ` [Code ${discordCode}]` : ""}): ${message}`,
      "DISCORD_API_ERROR",
      discordErrors,
    );
  }
}

/**
 * Role hierarchy error when an operation violates Discord's role hierarchy rules.
 */
export class HierarchyError extends DiscordInfraError {
  constructor(message: string, details?: unknown) {
    super(message, "HIERARCHY_ERROR", details);
  }
}

/**
 * Safety error when a destructive operation is blocked or confirmation fails.
 */
export class SafetyError extends DiscordInfraError {
  constructor(message: string, details?: unknown) {
    super(message, "SAFETY_ERROR", details);
  }
}

/**
 * Error thrown when an interactive operation is aborted by the user.
 */
export class ConfirmationAbortedError extends DiscordInfraError {
  constructor(message = "Operation aborted by user.") {
    super(message, "CONFIRMATION_ABORTED");
  }
}
