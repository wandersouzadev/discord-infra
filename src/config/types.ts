export type ChannelTypeString = "text" | "voice" | "announcement" | "forum";

export interface RoleConfig {
  name: string;
  discord_id?: string;
  color?: string | number;
  hoist?: boolean;
  mentionable?: boolean;
  position?: number;
  permissions?: string[];
}

export interface CategoryConfig {
  name: string;
  discord_id?: string;
  position?: number;
}

export interface ChannelConfig {
  name: string;
  discord_id?: string;
  category?: string;
  type?: ChannelTypeString;
  topic?: string;
  position?: number;
  slowmode?: number;
  permissions?: Record<string, Record<string, boolean>>;
}

/**
 * Mapping of:
 * Target Name (Category, Channel, or Role) -> Role Name (e.g. "@everyone", "MOD") -> Permission Map (e.g. { view_channel: true })
 */
export type PermissionsConfig = Record<string, Record<string, Record<string, boolean>>>;

export interface DiscordConfig {
  roles?: RoleConfig[];
  categories?: CategoryConfig[];
  channels?: ChannelConfig[];
  permissions?: PermissionsConfig;
}
