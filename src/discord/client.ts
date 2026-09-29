import { DiscordApiError } from "../utils/errors.js";
import { logger, registerSecretToken } from "../utils/logger.js";
import type {
  CreateChannelPayload,
  CreateRolePayload,
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  DiscordUser,
  ModifyChannelPayload,
  ModifyChannelPositionPayload,
  ModifyRolePayload,
  ModifyRolePositionPayload,
  DiscordApiErrorResponse,
} from "./types.js";

export interface DiscordClientOptions {
  token?: string;
  baseUrl?: string;
  maxRetries?: number;
}

export class DiscordRestClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;

  constructor(options: DiscordClientOptions = {}) {
    const rawToken = options.token ?? process.env.DISCORD_BOT_TOKEN;
    if (!rawToken || !rawToken.trim()) {
      throw new DiscordApiError(
        "DISCORD_BOT_TOKEN environment variable or option is required.",
        401,
      );
    }
    this.token = rawToken.trim();
    registerSecretToken(this.token);

    this.baseUrl = (
      options.baseUrl ??
      process.env.DISCORD_API_BASE_URL ??
      "https://discord.com/api/v10"
    ).replace(/\/+$/, "");

    this.maxRetries = options.maxRetries ?? 5;
  }

  /**
   * Internal request handler with rate limit handling, retries, and error normalization.
   */
  async request<T>(
    endpoint: string,
    options: {
      method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
      body?: unknown;
      headers?: Record<string, string>;
      auditReason?: string;
    } = {},
  ): Promise<T> {
    const method = options.method ?? "GET";
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

    const headers: Record<string, string> = {
      Authorization: `Bot ${this.token}`,
      "User-Agent": "DiscordBot (discord-infra, 1.0.0)",
      Accept: "application/json",
      ...options.headers,
    };

    if (options.auditReason) {
      headers["X-Audit-Log-Reason"] = encodeURIComponent(options.auditReason);
    }

    let bodyPayload: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyPayload = JSON.stringify(options.body);
    }

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      attempt++;
      logger.debug(`[HTTP] ${method} ${url} (Attempt ${attempt}/${this.maxRetries + 1})`);

      try {
        const response = await fetch(url, {
          method,
          headers,
          body: bodyPayload,
        });

        // Handle Rate Limits (HTTP 429)
        if (response.status === 429) {
          let retryAfterSec = 1.0;
          try {
            const data = (await response.json()) as { retry_after?: number };
            if (typeof data.retry_after === "number") {
              retryAfterSec = data.retry_after;
            }
          } catch {
            const headerVal = response.headers.get("Retry-After");
            if (headerVal) {
              retryAfterSec = Number.parseFloat(headerVal) || 1.0;
            }
          }

          const waitMs = Math.ceil(retryAfterSec * 1000) + 50; // extra 50ms buffer
          logger.warn(
            `Rate limited by Discord on ${method} ${endpoint}. Retrying after ${waitMs}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        // Handle Server Errors (5xx) with exponential backoff
        if (response.status >= 500 && attempt <= this.maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          logger.warn(
            `Discord returned ${response.status} on ${method} ${endpoint}. Retrying in ${backoffMs}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        // Success: 204 No Content
        if (response.status === 204) {
          return undefined as unknown as T;
        }

        // Error responses (4xx or remaining 5xx)
        if (!response.ok) {
          let errorData: DiscordApiErrorResponse | undefined;
          try {
            errorData = (await response.json()) as DiscordApiErrorResponse;
          } catch {
            // Non-JSON error response
          }

          const message =
            errorData?.message ??
            `HTTP request failed with status ${response.status} ${response.statusText}`;

          throw new DiscordApiError(message, response.status, errorData?.code, errorData?.errors);
        }

        return (await response.json()) as T;
      } catch (err) {
        if (err instanceof DiscordApiError) {
          throw err;
        }
        // Network or fetch connection failure
        if (attempt <= this.maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          logger.warn(
            `Network error on ${method} ${endpoint}: ${(err as Error).message}. Retrying in ${backoffMs}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        throw new DiscordApiError(
          `Request to Discord failed after ${attempt} attempts: ${(err as Error).message}`,
          0,
        );
      }
    }

    throw new DiscordApiError(
      `Max retries (${this.maxRetries}) exceeded for ${method} ${endpoint}`,
      0,
    );
  }

  // --- Current User ---
  async getCurrentUser(): Promise<DiscordUser> {
    return this.request<DiscordUser>("/users/@me");
  }

  // --- Guild ---
  async getGuild(guildId: string): Promise<DiscordGuild> {
    return this.request<DiscordGuild>(`/guilds/${guildId}`);
  }

  async getGuildMember(guildId: string, userId: string): Promise<DiscordGuildMember> {
    return this.request<DiscordGuildMember>(`/guilds/${guildId}/members/${userId}`);
  }

  // --- Roles ---
  async getRoles(guildId: string): Promise<DiscordRole[]> {
    return this.request<DiscordRole[]>(`/guilds/${guildId}/roles`);
  }

  async createRole(
    guildId: string,
    payload: CreateRolePayload,
    auditReason?: string,
  ): Promise<DiscordRole> {
    return this.request<DiscordRole>(`/guilds/${guildId}/roles`, {
      method: "POST",
      body: payload,
      auditReason,
    });
  }

  async updateRole(
    guildId: string,
    roleId: string,
    payload: ModifyRolePayload,
    auditReason?: string,
  ): Promise<DiscordRole> {
    return this.request<DiscordRole>(`/guilds/${guildId}/roles/${roleId}`, {
      method: "PATCH",
      body: payload,
      auditReason,
    });
  }

  async deleteRole(guildId: string, roleId: string, auditReason?: string): Promise<void> {
    return this.request<void>(`/guilds/${guildId}/roles/${roleId}`, {
      method: "DELETE",
      auditReason,
    });
  }

  async updateRolePositions(
    guildId: string,
    positions: ModifyRolePositionPayload[],
    auditReason?: string,
  ): Promise<DiscordRole[]> {
    return this.request<DiscordRole[]>(`/guilds/${guildId}/roles`, {
      method: "PATCH",
      body: positions,
      auditReason,
    });
  }

  // --- Channels ---
  async getChannels(guildId: string): Promise<DiscordChannel[]> {
    return this.request<DiscordChannel[]>(`/guilds/${guildId}/channels`);
  }

  async createChannel(
    guildId: string,
    payload: CreateChannelPayload,
    auditReason?: string,
  ): Promise<DiscordChannel> {
    return this.request<DiscordChannel>(`/guilds/${guildId}/channels`, {
      method: "POST",
      body: payload,
      auditReason,
    });
  }

  async updateChannel(
    channelId: string,
    payload: ModifyChannelPayload,
    auditReason?: string,
  ): Promise<DiscordChannel> {
    return this.request<DiscordChannel>(`/channels/${channelId}`, {
      method: "PATCH",
      body: payload,
      auditReason,
    });
  }

  async deleteChannel(channelId: string, auditReason?: string): Promise<void> {
    return this.request<void>(`/channels/${channelId}`, {
      method: "DELETE",
      auditReason,
    });
  }

  async updateChannelPositions(
    guildId: string,
    positions: ModifyChannelPositionPayload[],
    auditReason?: string,
  ): Promise<void> {
    return this.request<void>(`/guilds/${guildId}/channels`, {
      method: "PATCH",
      body: positions,
      auditReason,
    });
  }

  // --- Channel Permissions ---
  async updateChannelPermissions(
    channelId: string,
    overwriteId: string,
    payload: { allow: string; deny: string; type: number },
    auditReason?: string,
  ): Promise<void> {
    return this.request<void>(`/channels/${channelId}/permissions/${overwriteId}`, {
      method: "PUT",
      body: payload,
      auditReason,
    });
  }

  async deleteChannelPermissions(
    channelId: string,
    overwriteId: string,
    auditReason?: string,
  ): Promise<void> {
    return this.request<void>(`/channels/${channelId}/permissions/${overwriteId}`, {
      method: "DELETE",
      auditReason,
    });
  }
}
