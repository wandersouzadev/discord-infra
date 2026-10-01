import { describe, expect, it } from "vitest";
import type { DiscordConfig } from "../src/config/types.js";
import { buildBotGuildContext } from "../src/discord/hierarchy.js";
import { PERMISSION_FLAGS } from "../src/discord/permissions.js";
import type { DiscordServerState } from "../src/discord/state.js";
import {
  ChannelType,
  type DiscordChannel,
  type DiscordGuild,
  type DiscordGuildMember,
  type DiscordRole,
  type DiscordUser,
} from "../src/discord/types.js";
import { formatPlanJson, formatPlanOutput, generatePlan } from "../src/planner/planner.js";

describe("Planner and Diff Engine", () => {
  const botUser: DiscordUser = {
    id: "bot_1",
    username: "InfraBot",
    discriminator: "0001",
  };

  const guild: DiscordGuild = {
    id: "guild_1",
    name: "MMORPG Server",
    owner_id: "user_owner",
    roles: [],
  };

  const botRole: DiscordRole = {
    id: "role_bot",
    name: "InfraBot",
    color: 0,
    hoist: false,
    position: 20,
    permissions: (
      PERMISSION_FLAGS.administrator! |
      PERMISSION_FLAGS.manage_roles! |
      PERMISSION_FLAGS.manage_channels!
    ).toString(),
    managed: true,
    mentionable: false,
  };

  const existingModRole: DiscordRole = {
    id: "role_mod",
    name: "MOD",
    color: 0x3498db,
    hoist: true,
    position: 5,
    permissions: "0",
    managed: false,
    mentionable: false,
  };

  const existingStaffCat: DiscordChannel = {
    id: "cat_staff",
    name: "STAFF",
    type: ChannelType.GUILD_CATEGORY,
    position: 0,
  };

  const existingStaffChat: DiscordChannel = {
    id: "chan_staff_chat",
    name: "staff-chat",
    type: ChannelType.GUILD_TEXT,
    parent_id: "cat_staff",
    position: 0,
    topic: "Old Topic",
  };

  const existingRoles = [botRole, existingModRole];
  const existingCategories = [existingStaffCat];
  const existingChannels = [existingStaffChat];

  const member: DiscordGuildMember = {
    user: botUser,
    roles: [botRole.id],
    joined_at: new Date().toISOString(),
  };

  const botContext = buildBotGuildContext(botUser, guild, member, existingRoles);

  const mockServerState: DiscordServerState = {
    guild,
    botContext,
    roles: existingRoles,
    categories: existingCategories,
    channels: existingChannels,
    rolesByName: new Map([
      ["infrabot", botRole],
      ["mod", existingModRole],
    ]),
    rolesById: new Map([
      [botRole.id, botRole],
      [existingModRole.id, existingModRole],
    ]),
    categoriesByName: new Map([["staff", existingStaffCat]]),
    categoriesById: new Map([[existingStaffCat.id, existingStaffCat]]),
    channelsByName: new Map([["staff-chat", [existingStaffChat]]]),
    channelsById: new Map([[existingStaffChat.id, existingStaffChat]]),
  };

  it("calculates diff and generates plan for create, update, and moves", () => {
    const desiredConfig: DiscordConfig = {
      roles: [
        { name: "SUPPORT", color: "#2ECC71", hoist: false },
        { name: "MOD", color: "#E74C3C", hoist: true }, // color change
      ],
      categories: [
        { name: "STAFF", position: 0 },
        { name: "COMMUNITY", position: 1 }, // new category
      ],
      channels: [
        { name: "staff-chat", category: "STAFF", topic: "New Official Topic" }, // topic update
        { name: "general", category: "COMMUNITY", topic: "General chat" }, // new channel
      ],
      permissions: {
        STAFF: {
          "@everyone": { view_channel: false },
          MOD: { view_channel: true, send_messages: true },
        },
      },
    };

    const plan = generatePlan(desiredConfig, mockServerState);

    expect(plan.summary.create).toBe(3); // Role SUPPORT, Category COMMUNITY, Channel #general
    expect(plan.summary.update).toBe(4); // Role MOD (color), Channel staff-chat (topic), Permissions (2 overwrites)

    // Verify operation dependency order
    const roleCreateOp = plan.operations.find(
      (o) => o.type === "CREATE_ROLE" && o.resourceName === "SUPPORT",
    );
    const catCreateOp = plan.operations.find(
      (o) => o.type === "CREATE_CATEGORY" && o.resourceName === "COMMUNITY",
    );
    const chanCreateOp = plan.operations.find(
      (o) => o.type === "CREATE_CHANNEL" && o.resourceName.includes("general"),
    );

    expect(roleCreateOp).toBeDefined();
    expect(catCreateOp).toBeDefined();
    expect(chanCreateOp).toBeDefined();

    const roleCreateIdx = plan.operations.indexOf(roleCreateOp!);
    const catCreateIdx = plan.operations.indexOf(catCreateOp!);
    const chanCreateIdx = plan.operations.indexOf(chanCreateOp!);

    // Role creation precedes category creation, which precedes channel creation
    expect(roleCreateIdx).toBeLessThan(chanCreateIdx);
    expect(catCreateIdx).toBeLessThan(chanCreateIdx);
  });

  it("formats human-readable plan output cleanly", () => {
    const desiredConfig: DiscordConfig = {
      roles: [{ name: "SUPPORT", color: "#2ECC71" }],
      categories: [{ name: "DEVELOPMENT" }],
      channels: [{ name: "dev-chat", category: "DEVELOPMENT" }],
    };

    const plan = generatePlan(desiredConfig, mockServerState);
    const textOutput = formatPlanOutput(plan);

    expect(textOutput).toContain("Discord Infrastructure Plan");
    expect(textOutput).toContain("Create role: SUPPORT");
    expect(textOutput).toContain("Create category: DEVELOPMENT");
    expect(textOutput).toContain("Create #dev-chat");
    expect(textOutput).toContain("Summary:");
  });

  it("produces valid structured JSON output", () => {
    const desiredConfig: DiscordConfig = {
      roles: [{ name: "SUPPORT", color: "#2ECC71" }],
      categories: [],
      channels: [],
    };

    const plan = generatePlan(desiredConfig, mockServerState);
    const jsonOutput = formatPlanJson(plan);

    const parsed = JSON.parse(jsonOutput);
    expect(parsed.guild.id).toBe("guild_1");
    expect(parsed.summary.create).toBe(1);
    expect(parsed.operations[0].action).toBe("create_role");
  });

  it("renames channels and categories when discord_id is specified instead of duplicating", () => {
    const desiredConfig: DiscordConfig = {
      roles: [{ name: "MOD", discord_id: "role_mod" }],
      categories: [{ name: "▬▬▬ STAFF ▬▬▬", discord_id: "cat_staff", position: 0 }],
      channels: [
        {
          name: "🔒・staff-chat",
          discord_id: "chan_staff_chat",
          category: "▬▬▬ STAFF ▬▬▬",
          topic: "Old Topic",
        },
      ],
      permissions: {
        "▬▬▬ STAFF ▬▬▬": {
          "@everyone": { view_channel: false },
          MOD: { view_channel: true, send_messages: true },
        },
      },
    };

    const plan = generatePlan(desiredConfig, mockServerState);

    // Should NOT create new category or channel, should UPDATE instead!
    expect(plan.summary.create).toBe(0);

    const catUpdate = plan.operations.find(
      (o) => o.type === "UPDATE_CATEGORY" && o.resourceId === "cat_staff",
    );
    expect(catUpdate).toBeDefined();
    expect((catUpdate?.payload as Record<string, unknown>).name).toBe("▬▬▬ STAFF ▬▬▬");

    const chanUpdate = plan.operations.find(
      (o) => o.type === "UPDATE_CHANNEL" && o.resourceId === "chan_staff_chat",
    );
    expect(chanUpdate).toBeDefined();
    expect((chanUpdate?.payload as Record<string, unknown>).name).toBe("🔒・staff-chat");
  });
});
