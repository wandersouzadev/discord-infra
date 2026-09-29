/**
 * Discord Channel Types as defined in the official Discord API documentation:
 * https://discord.com/developers/docs/resources/channel#channel-object-channel-types
 */
export enum ChannelType {
  GUILD_TEXT = 0,
  DM = 1,
  GUILD_VOICE = 2,
  GROUP_DM = 3,
  GUILD_CATEGORY = 4,
  GUILD_ANNOUNCEMENT = 5,
  ANNOUNCEMENT_THREAD = 10,
  PUBLIC_THREAD = 11,
  PRIVATE_THREAD = 12,
  GUILD_STAGE_VOICE = 13,
  GUILD_DIRECTORY = 14,
  GUILD_FORUM = 15,
  GUILD_MEDIA = 16,
}

/**
 * Overwrite types: 0 = Role, 1 = Member
 */
export enum OverwriteType {
  ROLE = 0,
  MEMBER = 1,
}

export interface DiscordPermissionOverwrite {
  id: string;
  type: OverwriteType;
  allow: string; // Bitfield string
  deny: string; // Bitfield string
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number; // Integer color code (0 = default/none)
  hoist: boolean;
  icon?: string | null;
  unicode_emoji?: string | null;
  position: number;
  permissions: string; // Bitfield string
  managed: boolean; // Managed by an integration/bot
  mentionable: boolean;
  tags?: {
    bot_id?: string;
    integration_id?: string;
    premium_subscriber?: null;
    subscription_listing_id?: string;
    available_for_purchase?: null;
    guild_connections?: null;
  };
  flags?: number;
}

export interface DiscordChannel {
  id: string;
  type: ChannelType;
  guild_id?: string;
  position?: number;
  permission_overwrites?: DiscordPermissionOverwrite[];
  name?: string;
  topic?: string | null;
  nsfw?: boolean;
  last_message_id?: string | null;
  bitrate?: number;
  user_limit?: number;
  rate_limit_per_user?: number; // Slowmode in seconds
  recipients?: unknown[];
  icon?: string | null;
  owner_id?: string;
  application_id?: string;
  managed?: boolean;
  parent_id?: string | null; // Category ID
  last_pin_timestamp?: string | null;
  rtc_region?: string | null;
  video_quality_mode?: number;
  message_count?: number;
  member_count?: number;
  default_auto_archive_duration?: number;
  permissions?: string;
  flags?: number;
}

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
  system?: boolean;
  mfa_enabled?: boolean;
  banner?: string | null;
  accent_color?: number | null;
}

export interface DiscordGuildMember {
  user?: DiscordUser;
  nick?: string | null;
  avatar?: string | null;
  roles: string[]; // List of role IDs assigned to this member
  joined_at: string;
  premium_since?: string | null;
  deaf?: boolean;
  mute?: boolean;
  pending?: boolean;
  permissions?: string;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon?: string | null;
  owner_id: string;
  permissions?: string;
  roles: DiscordRole[];
}

export interface CreateRolePayload {
  name?: string;
  permissions?: string;
  color?: number;
  hoist?: boolean;
  icon?: string | null;
  unicode_emoji?: string | null;
  mentionable?: boolean;
}

export interface ModifyRolePayload {
  name?: string;
  permissions?: string;
  color?: number;
  hoist?: boolean;
  icon?: string | null;
  unicode_emoji?: string | null;
  mentionable?: boolean;
}

export interface ModifyRolePositionPayload {
  id: string;
  position?: number | null;
}

export interface CreateChannelPayload {
  name: string;
  type?: ChannelType;
  topic?: string;
  bitrate?: number;
  user_limit?: number;
  rate_limit_per_user?: number;
  position?: number;
  permission_overwrites?: DiscordPermissionOverwrite[];
  parent_id?: string | null;
  nsfw?: boolean;
}

export interface ModifyChannelPayload {
  name?: string;
  type?: ChannelType;
  position?: number | null;
  topic?: string | null;
  nsfw?: boolean | null;
  rate_limit_per_user?: number | null;
  bitrate?: number | null;
  user_limit?: number | null;
  permission_overwrites?: DiscordPermissionOverwrite[] | null;
  parent_id?: string | null;
}

export interface ModifyChannelPositionPayload {
  id: string;
  position?: number | null;
  lock_permissions?: boolean | null;
  parent_id?: string | null;
}

export interface DiscordApiErrorResponse {
  message: string;
  code: number;
  errors?: Record<string, unknown>;
}
