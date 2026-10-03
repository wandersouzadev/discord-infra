import { exec } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { numberToHexColor } from "../config/schema.js";
import type { DiscordConfig } from "../config/types.js";
import type {
  CategoryPreviewData,
  ChannelPreviewData,
  PreviewFileOptions,
  PreviewOptions,
  PreviewResult,
  ResolvedChannelPermission,
  RolePreviewData,
} from "./types.js";

export const PERMISSION_LABELS: Record<string, string> = {
  view_channel: "View Channels",
  manage_channels: "Manage Channels",
  manage_roles: "Manage Roles",
  manage_expressions: "Manage Expressions",
  view_audit_log: "View Audit Log",
  view_guild_insights: "View Server Insights",
  manage_webhooks: "Manage Webhooks",
  manage_guild: "Manage Server",
  create_instant_invite: "Create Invite",
  change_nickname: "Change Nickname",
  manage_nicknames: "Manage Nicknames",
  kick_members: "Kick Members",
  ban_members: "Ban Members",
  moderate_members: "Timeout Members",
  send_messages: "Send Messages",
  send_messages_in_threads: "Send Messages in Threads",
  create_public_threads: "Create Public Threads",
  create_private_threads: "Create Private Threads",
  embed_links: "Embed Links",
  attach_files: "Attach Files",
  add_reactions: "Add Reactions",
  use_external_emojis: "Use External Emojis",
  use_external_stickers: "Use External Stickers",
  mention_everyone: "Mention @everyone, @here",
  manage_messages: "Manage Messages",
  manage_threads: "Manage Threads",
  read_message_history: "Read Message History",
  send_tts_messages: "Send TTS Messages",
  send_voice_messages: "Send Voice Messages",
  send_polls: "Create Polls",
  use_application_commands: "Use Application Commands",
  connect: "Connect",
  speak: "Speak",
  stream: "Video / Screen Share",
  use_soundboard: "Use Soundboard",
  use_external_sounds: "Use External Sounds",
  use_vad: "Use Voice Activity",
  priority_speaker: "Priority Speaker",
  mute_members: "Mute Members",
  deafen_members: "Deafen Members",
  move_members: "Move Members",
  request_to_speak: "Request to Speak",
  administrator: "Administrator",
};

function formatPermissionLabel(perm: string): string {
  if (perm in PERMISSION_LABELS) {
    return PERMISSION_LABELS[perm]!;
  }
  return perm
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeHtml(unsafe?: string | null): string {
  if (!unsafe) return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeRoleColor(color?: string | number): string {
  if (color === undefined || color === null) return "#99AAB5";
  if (typeof color === "number") {
    return numberToHexColor(color) ?? "#99AAB5";
  }
  const str = color.trim();
  if (str.startsWith("#")) return str.toUpperCase();
  return `#${str.toUpperCase()}`;
}

/**
 * Build structured preview data from declarative DiscordConfig.
 */
export function preparePreviewData(config: DiscordConfig) {
  const roles = config.roles ?? [];
  const categories = config.categories ?? [];
  const channels = config.channels ?? [];
  const permissionsMap = config.permissions ?? {};

  // Build role map for fast color and position lookup
  const roleColorMap = new Map<string, string>();
  for (const r of roles) {
    roleColorMap.set(r.name, normalizeRoleColor(r.color));
  }
  roleColorMap.set("@everyone", "#99AAB5");

  // Format Roles Data
  // In Discord, roles at higher index / position have higher authority.
  // If no explicit position is assigned, preserve declaration order from top to bottom.
  const rolePreviewList: RolePreviewData[] = roles.map((r, index) => {
    const color = normalizeRoleColor(r.color);
    const assignedPosition = r.position ?? roles.length - index;
    const permissions = r.permissions ?? [];
    const isAdmin = permissions.includes("administrator");

    // Count how many channels/categories have overrides for this role
    let channelOverridesCount = 0;
    for (const overrides of Object.values(permissionsMap)) {
      if (overrides[r.name]) {
        channelOverridesCount++;
      }
    }
    for (const ch of channels) {
      if (ch.permissions?.[r.name]) {
        channelOverridesCount++;
      }
    }

    return {
      name: r.name,
      color,
      hoist: Boolean(r.hoist),
      mentionable: Boolean(r.mentionable),
      position: assignedPosition,
      isAdmin,
      permissions,
      channelOverridesCount,
    };
  });

  // Sort roles descending by position (highest hierarchy first)
  rolePreviewList.sort((a, b) => b.position - a.position);

  // Helper to extract resolved permissions for a target (channel or category)
  function resolveTargetPermissions(
    targetName: string,
    categoryName?: string,
    inlinePermissions?: Record<string, Record<string, boolean>>,
  ): { resolvedList: ResolvedChannelPermission[]; isPrivate: boolean } {
    const result: ResolvedChannelPermission[] = [];
    const roleNamesSet = new Set<string>();

    const categoryOverrides = categoryName ? (permissionsMap[categoryName] ?? {}) : {};
    const channelDirectOverrides = {
      ...(permissionsMap[targetName] ?? {}),
      ...(inlinePermissions ?? {}),
    };

    for (const r of Object.keys(categoryOverrides)) roleNamesSet.add(r);
    for (const r of Object.keys(channelDirectOverrides)) roleNamesSet.add(r);

    // Determine privacy: is @everyone view_channel explicitly denied?
    let everyoneView: boolean | undefined = undefined;
    if (categoryOverrides["@everyone"]?.view_channel !== undefined) {
      everyoneView = categoryOverrides["@everyone"].view_channel;
    }
    if (channelDirectOverrides["@everyone"]?.view_channel !== undefined) {
      everyoneView = channelDirectOverrides["@everyone"].view_channel;
    }
    const isPrivate = everyoneView === false;

    for (const roleName of roleNamesSet) {
      const catPerm = categoryOverrides[roleName] ?? {};
      const chanPerm = channelDirectOverrides[roleName] ?? {};
      const isDirect = Object.keys(chanPerm).length > 0;
      const mergedPerms: Record<string, boolean> = { ...catPerm, ...chanPerm };

      const allow: string[] = [];
      const deny: string[] = [];

      for (const [permKey, val] of Object.entries(mergedPerms)) {
        if (val === true) allow.push(permKey);
        else if (val === false) deny.push(permKey);
      }

      const canView = mergedPerms.view_channel ?? (roleName === "@everyone" ? !isPrivate : true);
      const canSend = mergedPerms.send_messages ?? true;

      result.push({
        roleName,
        roleColor: roleColorMap.get(roleName) ?? "#99AAB5",
        isInherited: !isDirect,
        allow,
        deny,
        canView,
        canSend,
      });
    }

    // Sort: @everyone first, then roles by order
    result.sort((a, b) => {
      if (a.roleName === "@everyone") return -1;
      if (b.roleName === "@everyone") return 1;
      return a.roleName.localeCompare(b.roleName);
    });

    return { resolvedList: result, isPrivate };
  }

  // Build Categories and Channels
  const sortedCategories = [...categories].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const channelsByCategory = new Map<string, ChannelPreviewData[]>();
  const uncategorizedChannels: ChannelPreviewData[] = [];

  for (const ch of channels) {
    const { resolvedList, isPrivate } = resolveTargetPermissions(
      ch.name,
      ch.category,
      ch.permissions,
    );
    const channelData: ChannelPreviewData = {
      name: ch.name,
      category: ch.category,
      type: ch.type ?? "text",
      topic: ch.topic,
      position: ch.position,
      slowmode: ch.slowmode,
      isPrivate,
      permissions: resolvedList,
    };

    if (ch.category) {
      const list = channelsByCategory.get(ch.category) ?? [];
      list.push(channelData);
      channelsByCategory.set(ch.category, list);
    } else {
      uncategorizedChannels.push(channelData);
    }
  }

  // Sort channels within each category by position
  for (const list of channelsByCategory.values()) {
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  uncategorizedChannels.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const categoryPreviewList: CategoryPreviewData[] = sortedCategories.map((cat) => {
    const { resolvedList } = resolveTargetPermissions(cat.name);
    return {
      name: cat.name,
      position: cat.position,
      channels: channelsByCategory.get(cat.name) ?? [],
      permissions: resolvedList,
    };
  });

  // Calculate high-level metrics
  const totalChannels = channels.length;
  const privateChannelsCount = channels.filter(
    (c) => resolveTargetPermissions(c.name, c.category, c.permissions).isPrivate,
  ).length;

  return {
    roles: rolePreviewList,
    categories: categoryPreviewList,
    uncategorizedChannels,
    totalChannels,
    privateChannelsCount,
  };
}

/**
 * Generate a complete, standalone, self-contained HTML page representing
 * the Discord server's roles, channels, categories, and permission matrix.
 */
export function generatePreviewHtml(config: DiscordConfig, options: PreviewOptions = {}): string {
  const title = options.title ?? "Discord Infrastructure";
  const data = preparePreviewData(config);

  const rawJsonConfig = JSON.stringify(config, null, 2);

  // SVG Icons
  const icons = {
    textChannel: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5.88657 21C5.5313 21 5.26388 20.6729 5.32115 20.3232L6.1408 15.3333H2.88657C2.5313 15.3333 2.26388 15.0062 2.32115 14.6565L2.59388 12.9899C2.63937 12.7121 2.87905 12.5109 3.1593 12.5109H6.60269L7.42234 7.52123H4.16811C3.81284 7.52123 3.54542 7.19417 3.60269 6.84447L3.87542 5.1778C3.92091 4.90003 4.16059 4.69885 4.44084 4.69885H7.88423L8.70388 0.289945C8.74937 0.0121735 8.98905 -0.188965 9.2693 -0.188965H10.936C11.2912 -0.188965 11.5587 0.138096 11.5014 0.487796L10.6817 4.69885H15.6817L16.5014 0.289945C16.5469 0.0121735 16.7865 -0.188965 17.0668 -0.188965H18.7335C19.0887 -0.188965 19.3562 0.138096 19.2989 0.487796L18.4792 4.69885H21.7335C22.0887 4.69885 22.3562 5.02591 22.2989 5.37561L22.0262 7.04228C21.9807 7.32005 21.741 7.52123 21.4608 7.52123H18.0174L17.1977 12.5109H20.452C20.8072 12.5109 21.0747 12.8379 21.0174 13.1876L20.7447 14.8543C20.6992 15.1321 20.4595 15.3333 20.1793 15.3333H16.7359L15.9162 20.3232C15.8707 20.601 15.6311 20.8022 15.3508 20.8022H13.6841C13.3289 20.8022 13.0614 20.4751 13.1187 20.1254L13.9384 15.3333H8.93836L8.11871 20.3232C8.07322 20.601 7.83354 20.8022 7.55329 20.8022H5.88657V21ZM9.37894 12.5109H14.3789L15.1986 7.52123H10.1986L9.37894 12.5109Z"/></svg>`,
    voiceChannel: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1a7 7 0 0 1 14 0v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z"/></svg>`,
    announcementChannel: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.61zM20.4 5c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.53.8 1.07 1.2 1.6.96-.72 2.21-1.65 3.2-2.4zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v4c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-4h3l5 4V5l-5 4H4z"/></svg>`,
    forumChannel: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-3 9H7V9h10v2zm0-4H7V5h10v2z"/></svg>`,
    lock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`,
    shield: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>`,
    check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
    cross: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    chevronDown: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>`,
    stopwatch: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>`,
    discordLogo: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Infrastructure Preview</title>
  <style>
    :root {
      --bg-darkest: #1e1f22;
      --bg-darker: #2b2d31;
      --bg-dark: #313338;
      --bg-card: #232428;
      --bg-card-hover: #35373c;
      --bg-input: #1e1f22;
      --border: #3f4147;
      --border-subtle: #2b2d31;
      --text-normal: #dbdee1;
      --text-muted: #949ba4;
      --text-header: #f2f3f5;
      --blurple: #5865f2;
      --blurple-hover: #4752c4;
      --green: #57f287;
      --green-dark: #248046;
      --red: #ed4245;
      --red-dark: #da373c;
      --yellow: #fee75c;
      --font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-darkest);
      color: var(--text-normal);
      font-family: var(--font-family);
      font-size: 14px;
      line-height: 1.5;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* Top Navigation Header */
    .top-header {
      background-color: var(--bg-darkest);
      border-bottom: 1px solid var(--border);
      height: 56px;
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      z-index: 100;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 700;
      font-size: 16px;
      color: var(--text-header);
    }

    .brand-icon {
      color: var(--blurple);
      display: flex;
      align-items: center;
    }

    .nav-tabs {
      display: flex;
      gap: 8px;
      background: var(--bg-darker);
      padding: 4px;
      border-radius: 8px;
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tab-btn:hover {
      color: var(--text-header);
      background: rgba(255, 255, 255, 0.05);
    }

    .tab-btn.active {
      background: var(--blurple);
      color: #ffffff;
    }

    .stats-badges {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .pill-badge {
      background: var(--bg-darker);
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .pill-badge strong {
      color: var(--text-header);
    }

    /* Main Container */
    .app-main {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
    }

    .view-container {
      display: none;
      width: 100%;
      height: 100%;
    }

    .view-container.active {
      display: flex;
    }

    /* ========================================= */
    /* View 1: Discord Server Preview (Split)   */
    /* ========================================= */
    .discord-sidebar {
      width: 280px;
      background-color: var(--bg-darker);
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
      flex-shrink: 0;
    }

    .sidebar-header {
      height: 48px;
      padding: 0 16px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.2);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 700;
      color: var(--text-header);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .search-box-container {
      padding: 10px 12px;
    }

    .search-input {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 10px;
      color: var(--text-header);
      font-size: 12px;
      outline: none;
    }

    .search-input:focus {
      border-color: var(--blurple);
    }

    .sidebar-channels-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 8px 8px 24px;
    }

    /* Category Header */
    .category-group {
      margin-top: 14px;
    }

    .category-group:first-child {
      margin-top: 4px;
    }

    .category-title-row {
      display: flex;
      align-items: center;
      padding: 4px 8px;
      cursor: pointer;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      user-select: none;
      border-radius: 4px;
    }

    .category-title-row:hover {
      color: var(--text-header);
    }

    .category-chevron {
      margin-right: 4px;
      transition: transform 0.2s;
      display: inline-flex;
      align-items: center;
    }

    .category-group.collapsed .category-chevron {
      transform: rotate(-90deg);
    }

    .category-group.collapsed .channels-list {
      display: none;
    }

    .category-name-text {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .category-count {
      font-size: 10px;
      background: var(--bg-darkest);
      padding: 1px 5px;
      border-radius: 8px;
    }

    /* Channel Item */
    .channel-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      margin: 1px 0;
      border-radius: 4px;
      color: var(--text-muted);
      cursor: pointer;
      font-weight: 500;
      font-size: 13.5px;
      transition: background 0.1s, color 0.1s;
      text-decoration: none;
    }

    .channel-item:hover {
      background: var(--bg-card-hover);
      color: var(--text-normal);
    }

    .channel-item.active {
      background: var(--bg-card-hover);
      color: var(--text-header);
      font-weight: 600;
    }

    .channel-icon {
      display: flex;
      align-items: center;
      color: var(--text-muted);
    }

    .channel-item.active .channel-icon {
      color: var(--text-header);
    }

    .channel-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .channel-badges {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .badge-lock {
      color: var(--text-muted);
      display: flex;
      align-items: center;
    }

    .badge-slowmode {
      font-size: 10px;
      background: var(--bg-darkest);
      color: var(--text-muted);
      padding: 1px 4px;
      border-radius: 3px;
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    /* Channel Details Main Panel */
    .channel-inspector {
      flex: 1;
      background: var(--bg-dark);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }

    .inspector-header {
      height: 48px;
      padding: 0 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      background: var(--bg-dark);
    }

    .inspector-title-area {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .inspector-name {
      font-size: 17px;
      font-weight: 700;
      color: var(--text-header);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .inspector-body {
      padding: 24px;
      max-width: 900px;
    }

    .topic-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-left: 4px solid var(--blurple);
      padding: 14px 18px;
      border-radius: 6px;
      margin-bottom: 24px;
      font-size: 14px;
      color: var(--text-normal);
    }

    .topic-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .metadata-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }

    .meta-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      padding: 12px;
      border-radius: 6px;
    }

    .meta-label {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase;
      font-weight: 600;
    }

    .meta-val {
      font-size: 14px;
      color: var(--text-header);
      font-weight: 600;
    }

    /* Permissions Overwrites Table */
    .overwrites-table-container {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 24px;
    }

    .overwrites-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    .overwrites-table th {
      background: var(--bg-darkest);
      color: var(--text-muted);
      padding: 10px 14px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      border-bottom: 1px solid var(--border);
    }

    .overwrites-table td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }

    .overwrites-table tr:last-child td {
      border-bottom: none;
    }

    .role-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      color: var(--text-header);
    }

    .role-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .tag-inherited {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
      font-weight: 500;
      margin-left: 6px;
    }

    .tag-direct {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(88, 101, 242, 0.2);
      color: #939ff7;
      font-weight: 500;
      margin-left: 6px;
    }

    .perm-chips-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .perm-chip {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .perm-chip.allow {
      background: rgba(87, 242, 135, 0.15);
      color: var(--green);
      border: 1px solid rgba(87, 242, 135, 0.3);
    }

    .perm-chip.deny {
      background: rgba(237, 66, 69, 0.15);
      color: var(--red);
      border: 1px solid rgba(237, 66, 69, 0.3);
    }

    /* ========================================= */
    /* View 2: Roles & Hierarchy                */
    /* ========================================= */
    .roles-view-container {
      width: 100%;
      height: 100%;
      background: var(--bg-dark);
      padding: 28px;
      overflow-y: auto;
    }

    .roles-content-max {
      max-width: 1000px;
      margin: 0 auto;
    }

    .roles-header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }

    .roles-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .role-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      transition: transform 0.1s, border-color 0.15s;
    }

    .role-card:hover {
      border-color: #5865f2;
    }

    .role-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .role-card-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .role-swatch-circle {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.15);
      flex-shrink: 0;
    }

    .role-card-name {
      font-size: 16px;
      font-weight: 700;
    }

    .role-rank-badge {
      background: var(--bg-darkest);
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .role-badges-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .role-status-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--bg-darkest);
      border: 1px solid var(--border);
      color: var(--text-muted);
    }

    .role-status-badge.admin {
      background: rgba(254, 231, 92, 0.15);
      color: var(--yellow);
      border-color: rgba(254, 231, 92, 0.3);
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .role-perms-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }

    .role-perm-item {
      font-size: 11px;
      background: var(--bg-darkest);
      border: 1px solid var(--border);
      color: var(--text-normal);
      padding: 3px 8px;
      border-radius: 4px;
    }

    /* ========================================= */
    /* View 3: Permissions Matrix Grid          */
    /* ========================================= */
    .matrix-view-container {
      width: 100%;
      height: 100%;
      background: var(--bg-dark);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .matrix-toolbar {
      padding: 14px 24px;
      background: var(--bg-darker);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .matrix-scroll-wrapper {
      flex: 1;
      overflow: auto;
      padding: 20px;
    }

    .matrix-table {
      border-collapse: separate;
      border-spacing: 0;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      width: 100%;
    }

    .matrix-table th,
    .matrix-table td {
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      padding: 10px 14px;
      font-size: 12px;
      white-space: nowrap;
    }

    .matrix-table th {
      background: var(--bg-darkest);
      position: sticky;
      top: 0;
      z-index: 10;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 11px;
      color: var(--text-muted);
    }

    .matrix-table th.col-channel {
      left: 0;
      z-index: 20;
      background: var(--bg-darkest);
      min-width: 240px;
    }

    .matrix-table td.col-channel {
      position: sticky;
      left: 0;
      background: var(--bg-card);
      z-index: 5;
      font-weight: 600;
      color: var(--text-header);
    }

    .matrix-table tr.category-header-row td {
      background: #1f2125;
      color: #939ff7;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.05em;
    }

    .matrix-table tr.category-header-row td.col-channel {
      background: #1f2125;
    }

    .matrix-cell {
      text-align: center;
      cursor: pointer;
      user-select: none;
    }

    .matrix-cell:hover {
      background: var(--bg-card-hover);
    }

    .cell-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .cell-badge.allow {
      background: rgba(87, 242, 135, 0.2);
      color: var(--green);
    }

    .cell-badge.readonly {
      background: rgba(254, 231, 92, 0.2);
      color: var(--yellow);
    }

    .cell-badge.deny {
      background: rgba(237, 66, 69, 0.2);
      color: var(--red);
    }

    .cell-badge.inherited {
      color: var(--text-muted);
      opacity: 0.7;
    }

    .cell-badge.default {
      color: rgba(255, 255, 255, 0.2);
    }

    /* ========================================= */
    /* View 4: Audit & Raw Configuration        */
    /* ========================================= */
    .audit-view-container {
      width: 100%;
      height: 100%;
      background: var(--bg-dark);
      padding: 28px;
      overflow-y: auto;
    }

    .audit-max {
      max-width: 960px;
      margin: 0 auto;
    }

    .raw-code-box {
      background: var(--bg-darkest);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      color: #a6d189;
      font-family: monospace;
      font-size: 12px;
      line-height: 1.5;
      overflow-x: auto;
      max-height: 500px;
    }

    /* Modal / Tooltip */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal-overlay.open {
      display: flex;
    }

    .modal-card {
      background: var(--bg-darker);
      border: 1px solid var(--border);
      border-radius: 8px;
      width: 480px;
      max-width: 90%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    }

    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--text-header);
      font-weight: 700;
      font-size: 16px;
    }

    .modal-body {
      padding: 20px;
      overflow-y: auto;
    }

    .modal-close-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 20px;
    }

    .modal-close-btn:hover {
      color: var(--text-header);
    }

    /* Scrollbars */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.4);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(0, 0, 0, 0.6);
    }
  </style>
</head>
<body>

  <!-- Top Header Navigation -->
  <header class="top-header">
    <div class="brand">
      <span class="brand-icon">${icons.discordLogo}</span>
      <span>${escapeHtml(title)}</span>
    </div>

    <div class="nav-tabs">
      <button class="tab-btn active" data-tab="discord-view">
        ${icons.textChannel} Discord Explorer
      </button>
      <button class="tab-btn" data-tab="roles-view">
        ${icons.shield} Roles &amp; Hierarchy
      </button>
      <button class="tab-btn" data-tab="matrix-view">
        ${icons.check} Permissions Matrix
      </button>
      <button class="tab-btn" data-tab="audit-view">
        Audit &amp; Config
      </button>
    </div>

    <div class="stats-badges">
      <span class="pill-badge" title="Total Categories">
        📁 <strong>${data.categories.length}</strong> Categories
      </span>
      <span class="pill-badge" title="Total Channels">
        💬 <strong>${data.totalChannels}</strong> Channels
      </span>
      <span class="pill-badge" title="Total Roles">
        🛡️ <strong>${data.roles.length}</strong> Roles
      </span>
      ${
        data.privateChannelsCount > 0
          ? `<span class="pill-badge" title="Private Channels restricted from @everyone">
              🔒 <strong>${data.privateChannelsCount}</strong> Private
            </span>`
          : ""
      }
    </div>
  </header>

  <!-- App Main Content Area -->
  <main class="app-main">

    <!-- TAB 1: Discord Explorer View -->
    <div id="discord-view" class="view-container active">
      <!-- Left Sidebar -->
      <aside class="discord-sidebar">
        <div class="sidebar-header">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${escapeHtml(title)}
          </span>
          <span style="color: var(--text-muted);">${icons.chevronDown}</span>
        </div>

        <div class="search-box-container">
          <input
            type="text"
            id="channel-filter-input"
            class="search-input"
            placeholder="Filter channels or categories..."
          />
        </div>

        <div class="sidebar-channels-scroll">
          ${
            data.uncategorizedChannels.length > 0
              ? `
              <div class="category-group" data-category="uncategorized">
                <div class="channels-list">
                  ${data.uncategorizedChannels
                    .map((ch, idx) => renderSidebarChannel(ch, idx === 0))
                    .join("")}
                </div>
              </div>
            `
              : ""
          }

          ${data.categories
            .map((cat, catIdx) => {
              return `
              <div class="category-group" data-category="${escapeHtml(cat.name)}">
                <div class="category-title-row" onclick="toggleCategoryCollapse(this)">
                  <span class="category-chevron">${icons.chevronDown}</span>
                  <span class="category-name-text">${escapeHtml(cat.name)}</span>
                  <span class="category-count">${cat.channels.length}</span>
                </div>
                <div class="channels-list">
                  ${cat.channels
                    .map((ch, chIdx) =>
                      renderSidebarChannel(
                        ch,
                        data.uncategorizedChannels.length === 0 && catIdx === 0 && chIdx === 0,
                      ),
                    )
                    .join("")}
                </div>
              </div>
            `;
            })
            .join("")}
        </div>
      </aside>

      <!-- Right Main Inspector -->
      <section class="channel-inspector" id="channel-inspector-panel">
        <!-- Default Inspector Content Populated dynamically by JS -->
        <div class="inspector-header">
          <div class="inspector-title-area">
            <span class="channel-icon" id="insp-icon">${icons.textChannel}</span>
            <span class="inspector-name" id="insp-name">Select a Channel</span>
          </div>
          <div id="insp-badges" class="channel-badges"></div>
        </div>

        <div class="inspector-body" id="insp-body">
          <div class="topic-card" id="insp-topic-box" style="display: none;">
            <div class="topic-label">Channel Topic</div>
            <div id="insp-topic-text"></div>
          </div>

          <div class="section-title">Channel Properties</div>
          <div class="metadata-grid" id="insp-meta-grid"></div>

          <div class="section-title">Role Permission Overwrites</div>
          <div class="overwrites-table-container">
            <table class="overwrites-table">
              <thead>
                <tr>
                  <th style="width: 220px;">Role / Target</th>
                  <th>Granted Permissions (ALLOW)</th>
                  <th>Denied Permissions (DENY)</th>
                </tr>
              </thead>
              <tbody id="insp-overwrites-body"></tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <!-- TAB 2: Roles & Hierarchy View -->
    <div id="roles-view" class="view-container">
      <div class="roles-view-container">
        <div class="roles-content-max">
          <div class="roles-header-bar">
            <div>
              <h2 style="color: var(--text-header); font-size: 20px;">Roles Hierarchy</h2>
              <p style="color: var(--text-muted); font-size: 13px;">
                Displayed in order of hierarchy (highest priority top to bottom).
              </p>
            </div>
            <div>
              <input
                type="text"
                id="role-filter-input"
                class="search-input"
                placeholder="Filter roles or permissions..."
                style="width: 260px;"
              />
            </div>
          </div>

          <div class="roles-list" id="roles-list-container">
            ${data.roles
              .map((role) => {
                const color = role.color ?? "#99aab5";
                return `
                <div class="role-card" data-role-name="${escapeHtml(role.name.toLowerCase())}" data-perms="${escapeHtml(role.permissions.join(" ").toLowerCase())}">
                  <div class="role-card-header">
                    <div class="role-card-title">
                      <div class="role-swatch-circle" style="background-color: ${color};"></div>
                      <span class="role-card-name" style="color: ${color};">${escapeHtml(role.name)}</span>
                      <span class="role-rank-badge">Position ${role.position}</span>
                      <span style="font-family: monospace; font-size: 11px; color: var(--text-muted);">${color}</span>
                    </div>

                    <div class="role-badges-group">
                      ${
                        role.isAdmin
                          ? `<span class="role-status-badge admin">${icons.shield} Administrator</span>`
                          : ""
                      }
                      ${role.hoist ? `<span class="role-status-badge">Hoisted</span>` : ""}
                      ${
                        role.mentionable ? `<span class="role-status-badge">Mentionable</span>` : ""
                      }
                      <span class="role-status-badge" title="Overrides in channels">
                        ${role.channelOverridesCount} Channel Overwrite${role.channelOverridesCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>

                  ${
                    role.permissions.length > 0
                      ? `
                    <div class="role-perms-list">
                      ${role.permissions
                        .map(
                          (p) =>
                            `<span class="role-perm-item">${escapeHtml(formatPermissionLabel(p))}</span>`,
                        )
                        .join("")}
                    </div>
                  `
                      : `<div style="color: var(--text-muted); font-size: 12px; font-style: italic;">No specific administrative permissions granted.</div>`
                  }
                </div>
              `;
              })
              .join("")}
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 3: Permissions Matrix Grid -->
    <div id="matrix-view" class="view-container">
      <div class="matrix-view-container">
        <div class="matrix-toolbar">
          <div style="font-weight: 600; color: var(--text-header);">
            Interactive Permissions Matrix (Channels &amp; Categories vs. Roles)
          </div>
          <div style="display: flex; gap: 12px; align-items: center; font-size: 12px;">
            <span class="cell-badge allow">${icons.check} Allow</span>
            <span class="cell-badge readonly">👁️ Read-Only</span>
            <span class="cell-badge deny">${icons.cross} Denied</span>
            <span class="cell-badge inherited">— Inherited</span>
          </div>
        </div>

        <div class="matrix-scroll-wrapper">
          <table class="matrix-table" id="permission-matrix-table">
            <thead>
              <tr>
                <th class="col-channel">Channel / Category</th>
                <th style="text-align: center;">@everyone</th>
                ${data.roles
                  .map(
                    (r) => `
                  <th style="text-align: center; color: ${r.color ?? "var(--text-header)"}">
                    ${escapeHtml(r.name)}
                  </th>
                `,
                  )
                  .join("")}
              </tr>
            </thead>
            <tbody>
              ${renderMatrixRows(data, icons)}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 4: Audit & Raw Configuration -->
    <div id="audit-view" class="view-container">
      <div class="audit-view-container">
        <div class="audit-max">
          <h2 style="color: var(--text-header); margin-bottom: 6px;">Infrastructure Health &amp; Audit</h2>
          <p style="color: var(--text-muted); margin-bottom: 24px;">
            Declarative server specification audit and raw configuration.
          </p>

          <div class="metadata-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
            <div class="meta-card">
              <div class="meta-label">Referential Integrity</div>
              <div class="meta-val" style="color: var(--green);">✓ Verified Valid</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">Total Categories</div>
              <div class="meta-val">${data.categories.length}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">Total Channels</div>
              <div class="meta-val">${data.totalChannels}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">Total Roles</div>
              <div class="meta-val">${data.roles.length}</div>
            </div>
          </div>

          <div class="section-title" style="margin-top: 32px;">Declarative Configuration JSON</div>
          <pre class="raw-code-box"><code>${escapeHtml(rawJsonConfig)}</code></pre>
        </div>
      </div>
    </div>

  </main>

  <!-- Cell Details Modal -->
  <div class="modal-overlay" id="cell-modal" onclick="closeCellModal(event)">
    <div class="modal-card" onclick="event.stopPropagation()">
      <div class="modal-header">
        <span id="modal-title">Permission Overwrite</span>
        <button class="modal-close-btn" onclick="closeCellModal()">&times;</button>
      </div>
      <div class="modal-body" id="modal-content"></div>
    </div>
  </div>

  <!-- Client-side Interactive JavaScript -->
  <script>
    const CHANNELS_DATA = ${JSON.stringify(getAllChannelsArray(data))};
    const CATEGORIES_DATA = ${JSON.stringify(data.categories)};
    const ROLES_DATA = ${JSON.stringify(data.roles)};

    // Navigation Tabs
    const tabButtons = document.querySelectorAll('.tab-btn');
    const viewContainers = document.querySelectorAll('.view-container');

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        tabButtons.forEach(b => b.classList.remove('active'));
        viewContainers.forEach(v => v.classList.remove('active'));

        btn.classList.add('active');
        const activeView = document.getElementById(targetTab);
        if (activeView) activeView.classList.add('active');
      });
    });

    // Category Collapsing
    function toggleCategoryCollapse(el) {
      const group = el.closest('.category-group');
      if (group) group.classList.toggle('collapsed');
    }

    // Select and inspect a channel
    function selectChannel(channelName) {
      document.querySelectorAll('.channel-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-channel-name') === channelName);
      });

      const channel = CHANNELS_DATA.find(c => c.name === channelName);
      if (!channel) return;

      document.getElementById('insp-name').textContent = channel.name;

      // Badges
      const badgesContainer = document.getElementById('insp-badges');
      badgesContainer.innerHTML = '';
      if (channel.isPrivate) {
        badgesContainer.innerHTML += '<span class="pill-badge" style="color: var(--red);">🔒 Private</span>';
      }
      if (channel.slowmode) {
        badgesContainer.innerHTML += '<span class="pill-badge">⏱️ ' + channel.slowmode + 's slowmode</span>';
      }
      badgesContainer.innerHTML += '<span class="pill-badge" style="text-transform: uppercase;">' + channel.type + '</span>';

      // Topic
      const topicBox = document.getElementById('insp-topic-box');
      const topicText = document.getElementById('insp-topic-text');
      if (channel.topic) {
        topicBox.style.display = 'block';
        topicText.textContent = channel.topic;
      } else {
        topicBox.style.display = 'none';
      }

      // Metadata Grid
      const metaGrid = document.getElementById('insp-meta-grid');
      metaGrid.innerHTML = \`
        <div class="meta-card">
          <div class="meta-label">Category</div>
          <div class="meta-val">\${channel.category || '(None)'}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Channel Type</div>
          <div class="meta-val" style="text-transform: capitalize;">\${channel.type}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Position Index</div>
          <div class="meta-val">\${channel.position !== undefined ? '#' + channel.position : 'Default'}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Access Mode</div>
          <div class="meta-val">\${channel.isPrivate ? '<span style="color: var(--red);">Restricted (Private)</span>' : '<span style="color: var(--green);">Public (@everyone)</span>'}</div>
        </div>
      \`;

      // Overwrites Table
      const overwritesBody = document.getElementById('insp-overwrites-body');
      overwritesBody.innerHTML = '';

      if (!channel.permissions || channel.permissions.length === 0) {
        overwritesBody.innerHTML = \`
          <tr>
            <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">
              No explicit permission overwrites. Uses standard server permissions.
            </td>
          </tr>
        \`;
      } else {
        channel.permissions.forEach(p => {
          const row = document.createElement('tr');

          const roleCell = document.createElement('td');
          roleCell.innerHTML = \`
            <div class="role-cell">
              <span class="role-dot" style="background-color: \${p.roleColor || '#99aab5'};"></span>
              <span>\${p.roleName}</span>
              \${p.isInherited ? '<span class="tag-inherited">Inherited</span>' : '<span class="tag-direct">Direct</span>'}
            </div>
          \`;

          const allowCell = document.createElement('td');
          if (p.allow && p.allow.length > 0) {
            allowCell.innerHTML = '<div class="perm-chips-wrap">' +
              p.allow.map(a => '<span class="perm-chip allow">✓ ' + formatPerm(a) + '</span>').join('') +
              '</div>';
          } else {
            allowCell.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">—</span>';
          }

          const denyCell = document.createElement('td');
          if (p.deny && p.deny.length > 0) {
            denyCell.innerHTML = '<div class="perm-chips-wrap">' +
              p.deny.map(d => '<span class="perm-chip deny">✕ ' + formatPerm(d) + '</span>').join('') +
              '</div>';
          } else {
            denyCell.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">—</span>';
          }

          row.appendChild(roleCell);
          row.appendChild(allowCell);
          row.appendChild(denyCell);
          overwritesBody.appendChild(row);
        });
      }
    }

    function formatPerm(perm) {
      return perm.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    // Filter channels
    const channelInput = document.getElementById('channel-filter-input');
    if (channelInput) {
      channelInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.channel-item').forEach(item => {
          const name = item.getAttribute('data-channel-name').toLowerCase();
          item.style.display = name.includes(query) ? 'flex' : 'none';
        });
        document.querySelectorAll('.category-group').forEach(group => {
          const catName = (group.getAttribute('data-category') || '').toLowerCase();
          const visibleChannels = group.querySelectorAll('.channel-item[style="display: flex;"]');
          if (catName.includes(query) || visibleChannels.length > 0 || query === '') {
            group.style.display = 'block';
          } else {
            group.style.display = 'none';
          }
        });
      });
    }

    // Filter roles
    const roleInput = document.getElementById('role-filter-input');
    if (roleInput) {
      roleInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        document.querySelectorAll('.role-card').forEach(card => {
          const name = card.getAttribute('data-role-name') || '';
          const perms = card.getAttribute('data-perms') || '';
          if (name.includes(query) || perms.includes(query)) {
            card.style.display = 'block';
          } else {
            card.style.display = 'none';
          }
        });
      });
    }

    // Matrix Cell Modal
    function openMatrixCell(targetName, roleName, detailsJson) {
      const details = JSON.parse(decodeURIComponent(detailsJson));
      document.getElementById('modal-title').textContent = roleName + ' @ ' + targetName;
      const content = document.getElementById('modal-content');

      let html = '<div style="margin-bottom: 16px;">';
      html += '<div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">Override Source: <strong>' + (details.isInherited ? 'Inherited from Category' : 'Direct Channel Override') + '</strong></div>';

      if (details.allow && details.allow.length > 0) {
        html += '<div style="font-weight: 700; color: var(--green); margin: 12px 0 6px;">Granted Permissions (ALLOW):</div>';
        html += '<div class="perm-chips-wrap">' + details.allow.map(a => '<span class="perm-chip allow">✓ ' + formatPerm(a) + '</span>').join('') + '</div>';
      }

      if (details.deny && details.deny.length > 0) {
        html += '<div style="font-weight: 700; color: var(--red); margin: 12px 0 6px;">Denied Permissions (DENY):</div>';
        html += '<div class="perm-chips-wrap">' + details.deny.map(d => '<span class="perm-chip deny">✕ ' + formatPerm(d) + '</span>').join('') + '</div>';
      }

      if ((!details.allow || details.allow.length === 0) && (!details.deny || details.deny.length === 0)) {
        html += '<div style="color: var(--text-muted); font-style: italic;">No specific allow/deny overwrites defined for this role on this target.</div>';
      }

      html += '</div>';
      content.innerHTML = html;
      document.getElementById('cell-modal').classList.add('open');
    }

    function closeCellModal() {
      document.getElementById('cell-modal').classList.remove('open');
    }

    // Initial channel selection
    if (CHANNELS_DATA.length > 0) {
      selectChannel(CHANNELS_DATA[0].name);
    }
  </script>
</body>
</html>`;
}

function renderSidebarChannel(ch: ChannelPreviewData, isActive = false): string {
  let iconSvg = `<span class="channel-icon">#</span>`;
  if (ch.type === "voice") {
    iconSvg = `<span class="channel-icon">🔊</span>`;
  } else if (ch.type === "announcement") {
    iconSvg = `<span class="channel-icon">📢</span>`;
  } else if (ch.type === "forum") {
    iconSvg = `<span class="channel-icon">💬</span>`;
  }

  return `
    <a
      class="channel-item ${isActive ? "active" : ""}"
      data-channel-name="${escapeHtml(ch.name)}"
      onclick="selectChannel('${escapeHtml(ch.name)}')"
    >
      ${iconSvg}
      <span class="channel-name">${escapeHtml(ch.name)}</span>
      <div class="channel-badges">
        ${ch.isPrivate ? `<span class="badge-lock" title="Private channel">🔒</span>` : ""}
        ${
          ch.slowmode
            ? `<span class="badge-slowmode" title="Slowmode ${ch.slowmode}s">⏱️ ${ch.slowmode}s</span>`
            : ""
        }
      </div>
    </a>
  `;
}

function getAllChannelsArray(data: ReturnType<typeof preparePreviewData>): ChannelPreviewData[] {
  const all: ChannelPreviewData[] = [...data.uncategorizedChannels];
  for (const cat of data.categories) {
    all.push(...cat.channels);
  }
  return all;
}

function renderMatrixRows(
  data: ReturnType<typeof preparePreviewData>,
  icons: Record<string, string>,
): string {
  const rows: string[] = [];

  for (const cat of data.categories) {
    // Category Row
    rows.push(`
      <tr class="category-header-row">
        <td class="col-channel">📁 ${escapeHtml(cat.name)}</td>
        ${renderMatrixCell(cat.permissions, "@everyone", cat.name, icons)}
        ${data.roles
          .map((r) => renderMatrixCell(cat.permissions, r.name, cat.name, icons))
          .join("")}
      </tr>
    `);

    // Channels under this Category
    for (const ch of cat.channels) {
      rows.push(`
        <tr>
          <td class="col-channel" style="padding-left: 28px;">
            ${ch.isPrivate ? "🔒 " : "# "}${escapeHtml(ch.name)}
          </td>
          ${renderMatrixCell(ch.permissions, "@everyone", ch.name, icons)}
          ${data.roles
            .map((r) => renderMatrixCell(ch.permissions, r.name, ch.name, icons))
            .join("")}
        </tr>
      `);
    }
  }

  return rows.join("");
}

function renderMatrixCell(
  permissions: ResolvedChannelPermission[],
  roleName: string,
  targetName: string,
  icons: Record<string, string>,
): string {
  const perm = permissions.find((p) => p.roleName === roleName);

  if (!perm) {
    return `<td class="matrix-cell"><span class="cell-badge default">—</span></td>`;
  }

  let badge: string;
  if (perm.deny.includes("view_channel") || perm.canView === false) {
    badge = `<span class="cell-badge deny">${icons.cross} Denied</span>`;
  } else if (perm.deny.includes("send_messages") || perm.canSend === false) {
    badge = `<span class="cell-badge readonly">👁️ Read-Only</span>`;
  } else if (perm.allow.length > 0) {
    badge = `<span class="cell-badge allow">${icons.check} Allow</span>`;
  } else if (perm.isInherited) {
    badge = `<span class="cell-badge inherited">— Inherited</span>`;
  } else {
    badge = `<span class="cell-badge allow">${icons.check} Allow</span>`;
  }

  const encodedJson = encodeURIComponent(JSON.stringify(perm));

  return `
    <td
      class="matrix-cell"
      onclick="openMatrixCell('${escapeHtml(targetName)}', '${escapeHtml(roleName)}', '${encodedJson}')"
      title="Click to view permission details"
    >
      ${badge}
    </td>
  `;
}

/**
 * Open the generated preview HTML file in the user's default browser.
 */
export function openInBrowser(filePath: string): void {
  const absPath = resolve(filePath);
  const platform = process.platform;
  let cmd: string;

  if (platform === "darwin") {
    cmd = `open "${absPath}"`;
  } else if (platform === "win32") {
    cmd = `start "" "${absPath}"`;
  } else {
    cmd = `xdg-open "${absPath}"`;
  }

  exec(cmd, () => {
    // Safely ignore browser opener errors (e.g. In headless CI)
  });
}

/**
 * Write generated HTML preview to disk and optionally open in browser.
 */
export function writePreviewHtml(
  config: DiscordConfig,
  options: PreviewFileOptions = {},
): PreviewResult {
  const outputPath = resolve(options.output ?? "discord-preview.html");
  const html = generatePreviewHtml(config, options);

  writeFileSync(outputPath, html, "utf-8");

  if (options.open) {
    openInBrowser(outputPath);
  }

  const data = preparePreviewData(config);

  return {
    outputPath,
    html,
    rolesCount: data.roles.length,
    categoriesCount: data.categories.length,
    channelsCount: data.totalChannels,
    privateChannelsCount: data.privateChannelsCount,
  };
}
