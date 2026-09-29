export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// Registered tokens to explicitly redact
const registeredTokens = new Set<string>();

/**
 * Register a secret token so the logger will always redact it if it appears in any string.
 */
export function registerSecretToken(token?: string): void {
  if (token && token.trim().length > 4) {
    registeredTokens.add(token.trim());
  }
}

/**
 * Regex to detect Discord bot tokens in format:
 * [A-Za-z0-9_-]{24,32}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,45}
 * or Authorization: Bot <token>
 */
const DISCORD_TOKEN_REGEX =
  /(?:Bot\s+)?([A-Za-z0-9_.-]{24,32}\.[A-Za-z0-9_.-]{6}\.[A-Za-z0-9_.-]{27,45})/g;

const AUTH_HEADER_REGEX = /(Authorization:\s*(?:Bot\s+)?)[\w.-]+/gi;

/**
 * Redact secret tokens and sensitive information from string output.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;

  let sanitized = text;

  // Replace registered tokens first
  for (const token of registeredTokens) {
    sanitized = sanitized.replaceAll(token, "[REDACTED_BOT_TOKEN]");
  }

  // Replace Authorization header values
  sanitized = sanitized.replace(AUTH_HEADER_REGEX, "$1[REDACTED_BOT_TOKEN]");

  // Replace Discord token pattern
  sanitized = sanitized.replace(DISCORD_TOKEN_REGEX, "[REDACTED_BOT_TOKEN]");

  return sanitized;
}

export class Logger {
  private level: LogLevel = "info";

  constructor(level?: LogLevel) {
    if (level && level in LOG_LEVELS) {
      this.level = level;
    } else {
      const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
      if (envLevel && envLevel in LOG_LEVELS) {
        this.level = envLevel;
      }
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(targetLevel: LogLevel): boolean {
    return LOG_LEVELS[targetLevel] >= LOG_LEVELS[this.level];
  }

  private formatMessage(args: unknown[]): string {
    const raw = args
      .map((arg) => {
        if (typeof arg === "string") {
          return arg;
        }
        if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}`;
        }
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      })
      .join(" ");

    return redactSecrets(raw);
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.debug(`[DEBUG] ${this.formatMessage(args)}`);
    }
  }

  info(...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.log(this.formatMessage(args));
    }
  }

  warn(...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.warn(`[WARN] ${this.formatMessage(args)}`);
    }
  }

  error(...args: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(`[ERROR] ${this.formatMessage(args)}`);
    }
  }
}

export const logger = new Logger();
