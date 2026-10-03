import { describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildBotGuildContext } from "../src/discord/hierarchy.js";
import { PERMISSION_FLAGS } from "../src/discord/permissions.js";
import type { DiscordServerState } from "../src/discord/state.js";
import {
  ChannelType,
  OverwriteType,
  type DiscordChannel,
  type DiscordGuild,
  type DiscordGuildMember,
  type DiscordRole,
  type DiscordUser,
} from "../src/discord/types.js";
import { exportStateToConfig, writeExportFiles } from "../src/exporter/exporter.js";

describe("Exporter Engine", () => {
  const botUser: DiscordUser = {
    id: "bot_1",
    username: "TestBot",
    discriminator: "0001",
  };

  const guild: DiscordGuild = {
    id: "guild_1",
    name: "Test Guild",
    owner_id: "owner_1",
    roles: [],
  };

  const modRole: DiscordRole = {
    id: "role_mod",
    name: "MOD",
    color: 0x3498db,
    hoist: true,
    position: 2,
    permissions: PERMISSION_FLAGS.manage_messages!.toString(),
    managed: false,
    mentionable: false,
  };

  const communityCat: DiscordChannel = {
    id: "cat_comm",
    name: "COMMUNITY",
    type: ChannelType.GUILD_CATEGORY,
    position: 0,
    permission_overwrites: [
      {
        id: "role_mod",
        type: OverwriteType.ROLE,
        allow: PERMISSION_FLAGS.view_channel!.toString(),
        deny: "0",
      },
    ],
  };

  const generalChan: DiscordChannel = {
    id: "chan_gen",
    name: "general",
    type: ChannelType.GUILD_TEXT,
    parent_id: "cat_comm",
    position: 0,
    topic: "Welcome to general",
  };

  const member: DiscordGuildMember = {
    user: botUser,
    roles: [],
    joined_at: new Date().toISOString(),
  };

  const mockServerState: DiscordServerState = {
    guild,
    botContext: buildBotGuildContext(botUser, guild, member, [modRole]),
    roles: [modRole],
    categories: [communityCat],
    channels: [generalChan],
    rolesByName: new Map([["mod", modRole]]),
    rolesById: new Map([[modRole.id, modRole]]),
    categoriesByName: new Map([["community", communityCat]]),
    categoriesById: new Map([[communityCat.id, communityCat]]),
    channelsByName: new Map([["general", [generalChan]]]),
    channelsById: new Map([[generalChan.id, generalChan]]),
    emojis: [],
    emojisByName: new Map(),
    emojisById: new Map(),
  };

  it("converts server state into declarative config", () => {
    const config = exportStateToConfig(mockServerState);

    expect(config.roles?.length).toBe(1);
    expect(config.roles?.[0]?.name).toBe("MOD");
    expect(config.roles?.[0]?.color).toBe("#3498DB");
    expect(config.roles?.[0]?.permissions).toContain("manage_messages");

    expect(config.categories?.length).toBe(1);
    expect(config.categories?.[0]?.name).toBe("COMMUNITY");

    expect(config.channels?.length).toBe(1);
    expect(config.channels?.[0]?.name).toBe("general");
    expect(config.channels?.[0]?.category).toBe("COMMUNITY");
    expect(config.channels?.[0]?.topic).toBe("Welcome to general");

    expect(config.permissions?.COMMUNITY?.MOD?.view_channel).toBe(true);
  });

  it("includes discord_id when includeIds option is true", () => {
    const config = exportStateToConfig(mockServerState, { includeIds: true });

    expect(config.roles?.[0]?.discord_id).toBe("role_mod");
    expect(config.categories?.[0]?.discord_id).toBe("cat_comm");
    expect(config.channels?.[0]?.discord_id).toBe("chan_gen");
  });

  it("writes configuration to YAML files on disk", () => {
    const config = exportStateToConfig(mockServerState);
    const testExportDir = join(process.cwd(), "scratch", "test-export");

    try {
      const { filesWritten } = writeExportFiles(config, {
        outputDir: testExportDir,
      });

      expect(filesWritten.length).toBeGreaterThan(0);
      expect(existsSync(join(testExportDir, "roles.yaml"))).toBe(true);
      expect(existsSync(join(testExportDir, "categories.yaml"))).toBe(true);
      expect(existsSync(join(testExportDir, "channels.yaml"))).toBe(true);
      expect(existsSync(join(testExportDir, "permissions.yaml"))).toBe(true);
    } finally {
      if (existsSync(testExportDir)) {
        rmSync(testExportDir, { recursive: true, force: true });
      }
    }
  });
});
