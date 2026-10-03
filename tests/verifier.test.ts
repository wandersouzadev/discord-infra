import { describe, expect, it } from "vitest";
import type { DiscordConfig } from "../src/config/types.js";
import { buildBotGuildContext } from "../src/discord/hierarchy.js";
import type { DiscordServerState } from "../src/discord/state.js";
import {
  ChannelType,
  type DiscordChannel,
  type DiscordGuild,
  type DiscordGuildMember,
  type DiscordRole,
  type DiscordUser,
} from "../src/discord/types.js";
import { formatVerificationOutput, verifyState } from "../src/verifier/verifier.js";

describe("Verifier Engine", () => {
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
    permissions: "0",
    managed: false,
    mentionable: false,
  };

  const communityCat: DiscordChannel = {
    id: "cat_comm",
    name: "COMMUNITY",
    type: ChannelType.GUILD_CATEGORY,
    position: 0,
  };

  const generalChan: DiscordChannel = {
    id: "chan_gen",
    name: "general",
    type: ChannelType.GUILD_TEXT,
    parent_id: "cat_comm",
    position: 2,
    topic: "General Chat",
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

  it("verifies state matches when desired matches current", () => {
    const desiredConfig: DiscordConfig = {
      roles: [{ name: "MOD", color: "#3498DB", hoist: true }],
      categories: [{ name: "COMMUNITY", position: 0 }],
      channels: [
        {
          name: "general",
          category: "COMMUNITY",
          position: 2,
          topic: "General Chat",
        },
      ],
    };

    const result = verifyState(desiredConfig, mockServerState);
    expect(result.inSync).toBe(true);
    expect(result.drift.length).toBe(0);

    const output = formatVerificationOutput(result);
    expect(output).toContain("0 drift");
  });

  it("detects drift when channels or roles differ", () => {
    const desiredConfig: DiscordConfig = {
      roles: [
        { name: "MOD", color: "#FF0000" }, // Different color
      ],
      categories: [{ name: "COMMUNITY" }],
      channels: [
        {
          name: "general",
          category: "COMMUNITY",
          position: 0, // Current is 2
          topic: "New Desired Topic", // Current is "General Chat"
        },
      ],
    };

    const result = verifyState(desiredConfig, mockServerState);
    expect(result.inSync).toBe(false);
    expect(result.rolesInSync).toBe(false);
    expect(result.channelsInSync).toBe(false);

    expect(result.drift.some((d) => d.field === "color")).toBe(true);
    expect(result.drift.some((d) => d.field === "position")).toBe(true);
    expect(result.drift.some((d) => d.field === "topic")).toBe(true);

    const output = formatVerificationOutput(result);
    expect(output).toContain("Drift detected");
  });
});
