import { describe, expect, it, vi } from "vitest";
import type { DiscordConfig } from "../src/config/types.js";
import type { DiscordRestClient } from "../src/discord/client.js";
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
import { executeWipe, formatWipeTargets, selectTargetsToWipe } from "../src/wiper/wiper.js";

describe("Wiper and Purge Engine", () => {
  const guild: DiscordGuild = {
    id: "guild_123",
    name: "Realm of Legends",
    owner_id: "owner_123",
    roles: [],
  };

  const catCommunity: DiscordChannel = {
    id: "cat_comm",
    name: "COMMUNITY",
    type: ChannelType.GUILD_CATEGORY,
    position: 0,
  };

  const catStaff: DiscordChannel = {
    id: "cat_staff",
    name: "STAFF",
    type: ChannelType.GUILD_CATEGORY,
    position: 1,
  };

  const chanWelcome: DiscordChannel = {
    id: "chan_welcome",
    name: "welcome",
    type: ChannelType.GUILD_TEXT,
    parent_id: "cat_comm",
    position: 0,
  };

  const chanGeneral: DiscordChannel = {
    id: "chan_gen",
    name: "general",
    type: ChannelType.GUILD_TEXT,
    parent_id: "cat_comm",
    position: 1,
  };

  const chanStaffChat: DiscordChannel = {
    id: "chan_staff",
    name: "staff-chat",
    type: ChannelType.GUILD_TEXT,
    parent_id: "cat_staff",
    position: 0,
  };

  const chanUnmanaged: DiscordChannel = {
    id: "chan_random",
    name: "random-test",
    type: ChannelType.GUILD_TEXT,
    position: 2,
  };

  // Mock Roles
  const roleEveryone: DiscordRole = {
    id: "guild_123",
    name: "@everyone",
    color: 0,
    hoist: false,
    position: 0,
    permissions: "0",
    managed: false,
    mentionable: false,
  };

  const roleSupport: DiscordRole = {
    id: "role_support",
    name: "SUPPORT",
    color: 0x2ecc71,
    hoist: false,
    position: 2,
    permissions: "0",
    managed: false,
    mentionable: false,
  };

  const roleMod: DiscordRole = {
    id: "role_mod",
    name: "MOD",
    color: 0x3498db,
    hoist: true,
    position: 5,
    permissions: "0",
    managed: false,
    mentionable: true,
  };

  const roleDeveloper: DiscordRole = {
    id: "role_dev",
    name: "DEVELOPER",
    color: 0xe67e22,
    hoist: true,
    position: 6,
    permissions: "0",
    managed: false,
    mentionable: true,
  };

  const botRole: DiscordRole = {
    id: "role_bot",
    name: "Bot Role",
    color: 0,
    hoist: false,
    position: 10,
    permissions: (PERMISSION_FLAGS.manage_roles! | PERMISSION_FLAGS.manage_channels!).toString(),
    managed: true,
    mentionable: false,
  };

  const roleAdmin: DiscordRole = {
    id: "role_admin",
    name: "ADMIN",
    color: 0,
    hoist: true,
    position: 15,
    permissions: "0",
    managed: false,
    mentionable: true,
  };

  const allServerRoles: DiscordRole[] = [
    roleEveryone,
    roleSupport,
    roleMod,
    roleDeveloper,
    botRole,
    roleAdmin,
  ];

  const botUser: DiscordUser = { id: "bot_1", username: "Bot", discriminator: "0001" };
  const member: DiscordGuildMember = {
    user: botUser,
    roles: [botRole.id],
    joined_at: new Date().toISOString(),
  };
  const botContext = buildBotGuildContext(botUser, guild, member, allServerRoles);

  const mockState: DiscordServerState = {
    guild,
    botContext,
    roles: allServerRoles,
    categories: [catCommunity, catStaff],
    channels: [chanWelcome, chanGeneral, chanStaffChat, chanUnmanaged],
    rolesByName: new Map([
      ["@everyone", roleEveryone],
      ["support", roleSupport],
      ["mod", roleMod],
      ["developer", roleDeveloper],
      ["bot role", botRole],
      ["admin", roleAdmin],
    ]),
    rolesById: new Map([
      [roleEveryone.id, roleEveryone],
      [roleSupport.id, roleSupport],
      [roleMod.id, roleMod],
      [roleDeveloper.id, roleDeveloper],
      [botRole.id, botRole],
      [roleAdmin.id, roleAdmin],
    ]),
    categoriesByName: new Map([
      ["community", catCommunity],
      ["staff", catStaff],
    ]),
    categoriesById: new Map([
      [catCommunity.id, catCommunity],
      [catStaff.id, catStaff],
    ]),
    channelsByName: new Map([
      ["welcome", [chanWelcome]],
      ["general", [chanGeneral]],
      ["staff-chat", [chanStaffChat]],
      ["random-test", [chanUnmanaged]],
    ]),
    channelsById: new Map([
      [chanWelcome.id, chanWelcome],
      [chanGeneral.id, chanGeneral],
      [chanStaffChat.id, chanStaffChat],
      [chanUnmanaged.id, chanUnmanaged],
    ]),
  };

  describe("Target Selection", () => {
    it("selects all channels, categories, and deletable roles by default when no config is provided", () => {
      const targets = selectTargetsToWipe(mockState);

      expect(targets.channels.length).toBe(4);
      expect(targets.categories.length).toBe(2);
      // Below bot's position 10: roleDeveloper (6), roleMod (5), roleSupport (2). Excludes @everyone, botRole, and roleAdmin
      expect(targets.roles?.length).toBe(3);
      expect(targets.roles?.map((r) => r.name)).toEqual(["DEVELOPER", "MOD", "SUPPORT"]);
    });

    it("filters only channels, categories, and roles defined in config when config is provided", () => {
      const config: DiscordConfig = {
        roles: [{ name: "MOD" }, { name: "SUPPORT" }],
        categories: [{ name: "COMMUNITY" }],
        channels: [{ name: "welcome" }],
      };

      const targets = selectTargetsToWipe(mockState, config);

      expect(targets.channels.length).toBe(1);
      expect(targets.channels[0]?.name).toBe("welcome");
      expect(targets.categories.length).toBe(1);
      expect(targets.categories[0]?.name).toBe("COMMUNITY");
      expect(targets.roles?.length).toBe(2);
      expect(targets.roles?.map((r) => r.name)).toEqual(["MOD", "SUPPORT"]);
    });

    it("selects all channels, categories, and roles when all flag is true even if config is provided", () => {
      const config: DiscordConfig = {
        roles: [{ name: "SUPPORT" }],
        categories: [{ name: "COMMUNITY" }],
        channels: [{ name: "welcome" }],
      };

      const targets = selectTargetsToWipe(mockState, config, { all: true });

      expect(targets.channels.length).toBe(4);
      expect(targets.categories.length).toBe(2);
      expect(targets.roles?.length).toBe(3);
    });

    it("omits categories and roles when channelsOnly flag is true", () => {
      const targets = selectTargetsToWipe(mockState, undefined, { all: true, channelsOnly: true });

      expect(targets.channels.length).toBe(4);
      expect(targets.categories.length).toBe(0);
      expect(targets.roles?.length).toBe(0);
    });

    it("omits channels and categories when rolesOnly flag is true", () => {
      const config: DiscordConfig = {
        roles: [{ name: "MOD" }],
        channels: [{ name: "welcome" }],
      };

      const targets = selectTargetsToWipe(mockState, config, { rolesOnly: true });

      expect(targets.channels.length).toBe(0);
      expect(targets.categories.length).toBe(0);
      expect(targets.roles?.length).toBe(1);
      expect(targets.roles?.[0]?.name).toBe("MOD");
    });

    it("selects all deletable roles when both all and rolesOnly are true", () => {
      const targets = selectTargetsToWipe(mockState, undefined, { all: true, rolesOnly: true });

      expect(targets.channels.length).toBe(0);
      expect(targets.categories.length).toBe(0);
      expect(targets.roles?.length).toBe(3);
      expect(targets.roles?.map((r) => r.name)).toEqual(["DEVELOPER", "MOD", "SUPPORT"]);
    });

    it("matches roles and channels with emoji/symbols in config against plain names on Discord", () => {
      const config: DiscordConfig = {
        roles: [{ name: "🛡️・MOD" }],
        categories: [{ name: "▬▬▬ COMMUNITY ▬▬▬" }],
        channels: [{ name: "👋・welcome" }, { name: "💬・general" }],
      };

      const targets = selectTargetsToWipe(mockState, config, { configOnly: true });

      expect(targets.channels.length).toBe(2);
      expect(targets.channels.map((c) => c.name)).toEqual(["welcome", "general"]);
      expect(targets.categories.length).toBe(1);
      expect(targets.categories[0]?.name).toBe("COMMUNITY");
      expect(targets.roles?.length).toBe(1);
      expect(targets.roles?.[0]?.name).toBe("MOD");
    });

    it("matches roles and channels by discord_id in config", () => {
      const config: DiscordConfig = {
        roles: [{ name: "renamed-mod", discord_id: "role_mod" }],
        channels: [{ name: "renamed-staff", discord_id: "chan_staff" }],
      };

      const targets = selectTargetsToWipe(mockState, config, { configOnly: true });

      expect(targets.channels.length).toBe(1);
      expect(targets.channels[0]?.id).toBe("chan_staff");
      expect(targets.roles?.length).toBe(1);
      expect(targets.roles?.[0]?.id).toBe("role_mod");
    });

    it("never includes @everyone or managed roles in wipe targets", () => {
      const config: DiscordConfig = {
        roles: [{ name: "@everyone" }, { name: "Bot Role" }],
      };

      const targets = selectTargetsToWipe(mockState, config, { configOnly: true });

      expect(targets.roles?.length).toBe(0);
    });

    it("excludes roles positioned above the bot due to role hierarchy", () => {
      const config: DiscordConfig = {
        roles: [{ name: "ADMIN" }], // Position 15 is higher than bot position 10
      };

      const targets = selectTargetsToWipe(mockState, config, { configOnly: true });

      expect(targets.roles?.length).toBe(0);
    });
  });

  describe("Target Formatting", () => {
    it("formats human-readable summary of targets including roles", () => {
      const targets = {
        channels: [chanWelcome],
        categories: [catCommunity],
        roles: [roleMod],
      };

      const output = formatWipeTargets(targets, "Realm of Legends");

      expect(output).toContain('Wipe Targets on "Realm of Legends":');
      expect(output).toContain("Channels (1):");
      expect(output).toContain("#welcome");
      expect(output).toContain("Categories (1):");
      expect(output).toContain("COMMUNITY");
      expect(output).toContain("Roles (1):");
      expect(output).toContain("@MOD");
    });

    it("handles targets without roles property gracefully", () => {
      const targets = {
        channels: [chanWelcome],
        categories: [catCommunity],
      };

      const output = formatWipeTargets(targets, "Realm of Legends");

      expect(output).toContain("Channels (1):");
      expect(output).toContain("Categories (1):");
      expect(output).not.toContain("Roles");
    });
  });

  describe("Wipe Execution", () => {
    it("executes dry-run without calling API deleteChannel or deleteRole", async () => {
      const mockClient = {
        deleteChannel: vi.fn(),
        deleteRole: vi.fn(),
      } as unknown as DiscordRestClient;

      const targets = {
        channels: [chanWelcome],
        categories: [catCommunity],
        roles: [roleMod],
      };

      const result = await executeWipe(targets, mockClient, {
        guildId: "guild_123",
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.deletedChannels.length).toBe(1);
      expect(result.deletedCategories.length).toBe(1);
      expect(result.deletedRoles.length).toBe(1);
      expect(mockClient.deleteChannel).not.toHaveBeenCalled();
      expect(mockClient.deleteRole).not.toHaveBeenCalled();
    });

    it("calls deleteChannel for channels first, categories second, and deleteRole for roles third", async () => {
      const callOrder: string[] = [];
      const mockClient = {
        deleteChannel: vi.fn().mockImplementation((id: string) => {
          callOrder.push(`channel:${id}`);
          return Promise.resolve();
        }),
        deleteRole: vi.fn().mockImplementation((_guildId: string, roleId: string) => {
          callOrder.push(`role:${roleId}`);
          return Promise.resolve();
        }),
      } as unknown as DiscordRestClient;

      const targets = {
        channels: [chanWelcome, chanGeneral],
        categories: [catCommunity],
        roles: [roleMod, roleSupport],
      };

      const result = await executeWipe(targets, mockClient, {
        guildId: "guild_123",
        dryRun: false,
      });

      expect(mockClient.deleteChannel).toHaveBeenCalledTimes(3);
      expect(mockClient.deleteRole).toHaveBeenCalledTimes(2);
      // Order: Channels, Categories, Roles
      expect(callOrder).toEqual([
        "channel:chan_welcome",
        "channel:chan_gen",
        "channel:cat_comm",
        "role:role_mod",
        "role:role_support",
      ]);
      expect(result.deletedChannels.length).toBe(2);
      expect(result.deletedCategories.length).toBe(1);
      expect(result.deletedRoles.length).toBe(2);
      expect(result.failed.length).toBe(0);
    });

    it("continues and records failure if one channel or role cannot be deleted", async () => {
      const mockClient = {
        deleteChannel: vi.fn().mockImplementation((id: string) => {
          if (id === "chan_welcome") {
            return Promise.reject(new Error("Cannot delete community rules channel"));
          }
          return Promise.resolve();
        }),
        deleteRole: vi.fn().mockImplementation((_guildId: string, roleId: string) => {
          if (roleId === "role_mod") {
            return Promise.reject(new Error("Role deletion rate limited"));
          }
          return Promise.resolve();
        }),
      } as unknown as DiscordRestClient;

      const targets = {
        channels: [chanWelcome, chanGeneral],
        categories: [],
        roles: [roleMod, roleSupport],
      };

      const result = await executeWipe(targets, mockClient, {
        guildId: "guild_123",
        dryRun: false,
      });

      expect(result.deletedChannels.length).toBe(1);
      expect(result.deletedChannels[0]?.id).toBe("chan_gen");
      expect(result.deletedRoles.length).toBe(1);
      expect(result.deletedRoles[0]?.id).toBe("role_support");
      expect(result.failed.length).toBe(2);
      expect(result.failed[0]?.id).toBe("chan_welcome");
      expect(result.failed[0]?.type).toBe("channel");
      expect(result.failed[1]?.id).toBe("role_mod");
      expect(result.failed[1]?.type).toBe("role");
      expect(result.failed[1]?.error).toContain("Role deletion rate limited");
    });
  });
});
