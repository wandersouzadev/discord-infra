import { describe, expect, it, vi } from "vitest";
import type { DiscordConfig } from "../src/config/types.js";
import type { DiscordRestClient } from "../src/discord/client.js";
import type { DiscordServerState } from "../src/discord/state.js";
import { buildBotGuildContext } from "../src/discord/hierarchy.js";
import {
  ChannelType,
  type DiscordChannel,
  type DiscordGuild,
  type DiscordGuildMember,
  type DiscordUser,
} from "../src/discord/types.js";
import { executeWipe, formatWipeTargets, selectTargetsToWipe } from "../src/wiper/wiper.js";

describe("Wiper and Channel Purge Engine", () => {
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

  const botUser: DiscordUser = { id: "bot_1", username: "Bot", discriminator: "0001" };
  const member: DiscordGuildMember = {
    user: botUser,
    roles: [],
    joined_at: new Date().toISOString(),
  };
  const botContext = buildBotGuildContext(botUser, guild, member, []);

  const mockState: DiscordServerState = {
    guild,
    botContext,
    roles: [],
    categories: [catCommunity, catStaff],
    channels: [chanWelcome, chanGeneral, chanStaffChat, chanUnmanaged],
    rolesByName: new Map(),
    rolesById: new Map(),
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
    it("selects all channels and categories by default even without all flag", () => {
      const targets = selectTargetsToWipe(mockState);

      expect(targets.channels.length).toBe(4);
      expect(targets.categories.length).toBe(2);
    });

    it("selects all channels and categories even when config is provided unless configOnly is explicitly set", () => {
      const config: DiscordConfig = {
        categories: [{ name: "COMMUNITY" }],
        channels: [{ name: "welcome" }],
      };

      const targets = selectTargetsToWipe(mockState, config);

      expect(targets.channels.length).toBe(4);
      expect(targets.categories.length).toBe(2);
    });

    it("selects all channels and categories when all flag is true", () => {
      const targets = selectTargetsToWipe(mockState, undefined, { all: true });

      expect(targets.channels.length).toBe(4);
      expect(targets.categories.length).toBe(2);
    });

    it("omits categories when channelsOnly flag is true", () => {
      const targets = selectTargetsToWipe(mockState, undefined, { all: true, channelsOnly: true });

      expect(targets.channels.length).toBe(4);
      expect(targets.categories.length).toBe(0);
    });

    it("filters only channels and categories defined in config when configOnly is true", () => {
      const config: DiscordConfig = {
        categories: [{ name: "COMMUNITY" }],
        channels: [{ name: "welcome" }, { name: "general" }],
      };

      const targets = selectTargetsToWipe(mockState, config, { configOnly: true });

      expect(targets.channels.length).toBe(2);
      expect(targets.channels.map((c) => c.name)).toEqual(["welcome", "general"]);
      expect(targets.categories.length).toBe(1);
      expect(targets.categories[0]?.name).toBe("COMMUNITY");
    });

    it("matches channels with emoji/symbols in config against plain channel names on Discord", () => {
      const config: DiscordConfig = {
        categories: [{ name: "▬▬▬ COMMUNITY ▬▬▬" }],
        channels: [{ name: "👋・welcome" }, { name: "💬・general" }],
      };

      const targets = selectTargetsToWipe(mockState, config, { configOnly: true });

      expect(targets.channels.length).toBe(2);
      expect(targets.channels.map((c) => c.name)).toEqual(["welcome", "general"]);
      expect(targets.categories.length).toBe(1);
      expect(targets.categories[0]?.name).toBe("COMMUNITY");
    });

    it("matches channels by discord_id in config", () => {
      const config: DiscordConfig = {
        channels: [{ name: "renamed-staff", discord_id: "chan_staff" }],
      };

      const targets = selectTargetsToWipe(mockState, config, { configOnly: true });

      expect(targets.channels.length).toBe(1);
      expect(targets.channels[0]?.id).toBe("chan_staff");
    });
  });

  describe("Target Formatting", () => {
    it("formats human-readable summary of targets", () => {
      const targets = {
        channels: [chanWelcome],
        categories: [catCommunity],
      };

      const output = formatWipeTargets(targets, "Realm of Legends");

      expect(output).toContain('Wipe Targets on "Realm of Legends":');
      expect(output).toContain("Channels (1):");
      expect(output).toContain("#welcome");
      expect(output).toContain("Categories (1):");
      expect(output).toContain("COMMUNITY");
    });
  });

  describe("Wipe Execution", () => {
    it("executes dry-run without calling API deleteChannel", async () => {
      const mockClient = {
        deleteChannel: vi.fn(),
      } as unknown as DiscordRestClient;

      const targets = {
        channels: [chanWelcome],
        categories: [catCommunity],
      };

      const result = await executeWipe(targets, mockClient, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.deletedChannels.length).toBe(1);
      expect(result.deletedCategories.length).toBe(1);
      expect(mockClient.deleteChannel).not.toHaveBeenCalled();
    });

    it("calls deleteChannel for channels first then categories", async () => {
      const callOrder: string[] = [];
      const mockClient = {
        deleteChannel: vi.fn().mockImplementation((id: string) => {
          callOrder.push(id);
          return Promise.resolve();
        }),
      } as unknown as DiscordRestClient;

      const targets = {
        channels: [chanWelcome, chanGeneral],
        categories: [catCommunity],
      };

      const result = await executeWipe(targets, mockClient, { dryRun: false });

      expect(mockClient.deleteChannel).toHaveBeenCalledTimes(3);
      // Channels deleted before categories
      expect(callOrder).toEqual(["chan_welcome", "chan_gen", "cat_comm"]);
      expect(result.deletedChannels.length).toBe(2);
      expect(result.deletedCategories.length).toBe(1);
      expect(result.failed.length).toBe(0);
    });

    it("continues and records failure if one channel cannot be deleted", async () => {
      const mockClient = {
        deleteChannel: vi.fn().mockImplementation((id: string) => {
          if (id === "chan_welcome") {
            return Promise.reject(new Error("Cannot delete community rules channel"));
          }
          return Promise.resolve();
        }),
      } as unknown as DiscordRestClient;

      const targets = {
        channels: [chanWelcome, chanGeneral],
        categories: [],
      };

      const result = await executeWipe(targets, mockClient, { dryRun: false });

      expect(result.deletedChannels.length).toBe(1);
      expect(result.deletedChannels[0]?.id).toBe("chan_gen");
      expect(result.failed.length).toBe(1);
      expect(result.failed[0]?.id).toBe("chan_welcome");
      expect(result.failed[0]?.error).toContain("Cannot delete community rules channel");
    });
  });
});
