/**
 * Discord Permission Flags and bit shifts.
 * Reference: https://discord.com/developers/docs/topics/permissions#permissions-bitwise-permission-flags
 */
export const PERMISSION_FLAGS: Record<string, bigint> = {
  create_instant_invite: 1n << 0n,
  kick_members: 1n << 1n,
  ban_members: 1n << 2n,
  administrator: 1n << 3n,
  manage_channels: 1n << 4n,
  manage_guild: 1n << 5n,
  add_reactions: 1n << 6n,
  view_audit_log: 1n << 7n,
  priority_speaker: 1n << 8n,
  stream: 1n << 9n,
  view_channel: 1n << 10n,
  send_messages: 1n << 11n,
  send_tts_messages: 1n << 12n,
  manage_messages: 1n << 13n,
  embed_links: 1n << 14n,
  attach_files: 1n << 15n,
  read_message_history: 1n << 16n,
  mention_everyone: 1n << 17n,
  use_external_emojis: 1n << 18n,
  view_guild_insights: 1n << 19n,
  connect: 1n << 20n,
  speak: 1n << 21n,
  mute_members: 1n << 22n,
  deafen_members: 1n << 23n,
  move_members: 1n << 24n,
  use_vad: 1n << 25n,
  change_nickname: 1n << 26n,
  manage_nicknames: 1n << 27n,
  manage_roles: 1n << 28n,
  manage_webhooks: 1n << 29n,
  manage_guild_expressions: 1n << 30n,
  use_application_commands: 1n << 31n,
  request_to_speak: 1n << 32n,
  manage_events: 1n << 33n,
  manage_threads: 1n << 34n,
  create_public_threads: 1n << 35n,
  create_private_threads: 1n << 36n,
  use_external_stickers: 1n << 37n,
  send_messages_in_threads: 1n << 38n,
  use_embedded_activities: 1n << 39n,
  moderate_members: 1n << 40n,
  view_creator_monetization_analytics: 1n << 41n,
  use_soundboard: 1n << 42n,
  create_guild_expressions: 1n << 43n,
  create_events: 1n << 44n,
  use_external_sounds: 1n << 45n,
  send_voice_messages: 1n << 46n,
  send_polls: 1n << 49n,
  use_external_apps: 1n << 50n,
};

// Normalized reverse lookup: bit value to lowercase name
export const PERMISSION_NAMES_BY_FLAG = new Map<bigint, string>(
  Object.entries(PERMISSION_FLAGS).map(([name, bit]) => [bit, name]),
);

/**
 * Normalize permission name to standard snake_case key.
 */
export function normalizePermissionName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Check if a permission name is valid in Discord.
 */
export function isValidPermission(name: string): boolean {
  return normalizePermissionName(name) in PERMISSION_FLAGS;
}

/**
 * Convert a list of permission names to a bitfield string.
 */
export function permissionsToBitfield(names: string[]): string {
  let bitfield = 0n;
  for (const name of names) {
    const key = normalizePermissionName(name);
    const bit = PERMISSION_FLAGS[key];
    if (bit !== undefined) {
      bitfield |= bit;
    }
  }
  return bitfield.toString();
}

/**
 * Convert a bitfield string into a list of permission names.
 */
export function bitfieldToPermissions(bitfieldStr: string): string[] {
  const result: string[] = [];
  try {
    const bitfield = BigInt(bitfieldStr || "0");
    for (const [name, bit] of Object.entries(PERMISSION_FLAGS)) {
      if ((bitfield & bit) === bit) {
        result.push(name);
      }
    }
  } catch {
    // Return empty array if invalid bitfield string
  }
  return result;
}

export type PermissionMap = Record<string, boolean>;

/**
 * Convert a human-readable permission map (e.g. { view_channel: true, send_messages: false })
 * into Discord allow and deny bitfields.
 */
export function permissionMapToOverwrites(perms: PermissionMap): {
  allow: string;
  deny: string;
} {
  let allowBitfield = 0n;
  let denyBitfield = 0n;

  for (const [name, value] of Object.entries(perms)) {
    const key = normalizePermissionName(name);
    const bit = PERMISSION_FLAGS[key];
    if (bit === undefined) {
      continue;
    }

    if (value === true) {
      allowBitfield |= bit;
    } else if (value === false) {
      denyBitfield |= bit;
    }
    // undefined or null means neutral/inherit, neither allow nor deny
  }

  return {
    allow: allowBitfield.toString(),
    deny: denyBitfield.toString(),
  };
}

/**
 * Convert Discord allow and deny bitfields into a human-readable permission map.
 */
export function overwritesToPermissionMap(allowStr: string, denyStr: string): PermissionMap {
  const map: PermissionMap = {};
  const allow = BigInt(allowStr || "0");
  const deny = BigInt(denyStr || "0");

  for (const [name, bit] of Object.entries(PERMISSION_FLAGS)) {
    if ((allow & bit) === bit) {
      map[name] = true;
    } else if ((deny & bit) === bit) {
      map[name] = false;
    }
  }

  return map;
}

/**
 * Check if a bitfield has a specific permission (or Administrator).
 */
export function hasPermission(bitfieldStr: string, permissionName: string): boolean {
  try {
    const bitfield = BigInt(bitfieldStr || "0");
    // Administrator grants everything in Discord
    if ((bitfield & PERMISSION_FLAGS.administrator!) === PERMISSION_FLAGS.administrator) {
      return true;
    }
    const key = normalizePermissionName(permissionName);
    const bit = PERMISSION_FLAGS[key];
    if (bit === undefined) return false;
    return (bitfield & bit) === bit;
  } catch {
    return false;
  }
}
