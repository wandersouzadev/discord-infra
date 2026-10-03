import { describe, expect, it, vi } from "vitest";
import { loadConfig, readImageAsDataUri, resolveEmojiDataUri } from "../src/config/loader.js";
import { EmojiSchema, validateReferentialIntegrity } from "../src/config/schema.js";
import type { DiscordConfig } from "../src/config/types.js";
import type { DiscordRestClient } from "../src/discord/client.js";
import { buildBotGuildContext } from "../src/discord/hierarchy.js";
import type { DiscordServerState } from "../src/discord/state.js";
import type { DiscordEmoji, DiscordGuild, DiscordRole, DiscordUser } from "../src/discord/types.js";
import { executePlan } from "../src/executor/executor.js";
import { exportStateToConfig, writeExportFiles } from "../src/exporter/exporter.js";
import { computeDiff } from "../src/planner/diff.js";
import { formatPlanOutput, generatePlan } from "../src/planner/planner.js";
import type { Plan } from "../src/planner/types.js";
import { ConfigValidationError } from "../src/utils/errors.js";
import { verifyState } from "../src/verifier/verifier.js";
import { executeWipe, selectTargetsToWipe } from "../src/wiper/wiper.js";

describe("Guild Emojis Management", () => {
  const botUser: DiscordUser = {
    id: "bot_123",
    username: "InfraBot",
    discriminator: "0001",
  };

  const guild: DiscordGuild = {
    id: "guild_123",
    name: "Realm Guild",
    owner_id: "user_owner",
    roles: [],
  };

  const paladinRole: DiscordRole = {
    id: "role_paladin",
    name: "Paladin",
    color: 0x3498db,
    hoist: true,
    position: 10,
    permissions: "0",
    managed: false,
    mentionable: true,
  };

  const existingEmoji: DiscordEmoji = {
    id: "emoji_sword",
    name: "realm_sword",
    roles: [paladinRole.id],
    managed: false,
    require_colons: true,
    animated: false,
  };

  const managedBotEmoji: DiscordEmoji = {
    id: "emoji_managed",
    name: "bot_icon",
    roles: [],
    managed: true, // e.g. twitch/integration managed
    require_colons: true,
    animated: false,
  };

  const mockState: DiscordServerState = {
    guild,
    botContext: buildBotGuildContext(botUser, guild, { user: botUser, roles: [], joined_at: "" }, [
      paladinRole,
    ]),
    roles: [paladinRole],
    categories: [],
    channels: [],
    emojis: [existingEmoji, managedBotEmoji],
    rolesByName: new Map([["paladin", paladinRole]]),
    rolesById: new Map([[paladinRole.id, paladinRole]]),
    categoriesByName: new Map(),
    categoriesById: new Map(),
    channelsByName: new Map(),
    channelsById: new Map(),
    emojisByName: new Map([
      ["realm_sword", existingEmoji],
      ["bot_icon", managedBotEmoji],
    ]),
    emojisById: new Map([
      [existingEmoji.id, existingEmoji],
      [managedBotEmoji.id, managedBotEmoji],
    ]),
  };

  describe("Schema & Loader", () => {
    it("validates valid emoji configuration", () => {
      const valid = EmojiSchema.parse({
        name: "realm_shield",
        file: "emojis/realm_shield.png",
        roles: ["Paladin"],
      });
      expect(valid.name).toBe("realm_shield");
      expect(valid.roles).toEqual(["Paladin"]);
    });

    it("rejects invalid emoji names", () => {
      // Spaces not allowed
      expect(() => EmojiSchema.parse({ name: "realm shield" })).toThrow();
      // Hyphens not allowed by Discord for custom emojis
      expect(() => EmojiSchema.parse({ name: "realm-shield" })).toThrow();
      // Too short (< 2 chars)
      expect(() => EmojiSchema.parse({ name: "a" })).toThrow();
      // Too long (> 32 chars)
      expect(() => EmojiSchema.parse({ name: "a".repeat(33) })).toThrow();
    });

    it("detects duplicate emoji names", () => {
      const config: DiscordConfig = {
        roles: [{ name: "Paladin" }],
        emojis: [
          { name: "realm_sword", file: "emojis/realm_sword.png" },
          { name: "REALM_SWORD", file: "emojis/realm_sword.png" },
        ],
      };
      expect(() => validateReferentialIntegrity(config)).toThrow(ConfigValidationError);
    });

    it("flags emoji referencing non-existent role", () => {
      const config: DiscordConfig = {
        roles: [{ name: "Paladin" }],
        emojis: [
          { name: "realm_sword", file: "emojis/realm_sword.png", roles: ["NonExistentRole"] },
        ],
      };
      expect(() => validateReferentialIntegrity(config)).toThrow(ConfigValidationError);
    });

    it("successfully loads emojis and auto-discovers files from discord directory", () => {
      const config = loadConfig({ configPath: "discord" });
      expect(config.emojis?.length).toBeGreaterThanOrEqual(2);
      const names = config.emojis?.map((e) => e.name);
      expect(names).toContain("realm_sword");
      expect(names).toContain("mana_potion");
    });

    it("reads image file as base64 Data URI", () => {
      const dataUri = readImageAsDataUri("discord/emojis/realm_sword.png");
      expect(dataUri).toMatch(/^data:image\/png;base64,/);
    });

    it("resolves emoji data URI from config", () => {
      const dataUri = resolveEmojiDataUri(
        { name: "realm_sword", file: "emojis/realm_sword.png" },
        "discord",
      );
      expect(dataUri).toBeDefined();
      expect(dataUri).toMatch(/^data:image\/png;base64,/);
    });
  });

  describe("Planner & Diff Engine", () => {
    it("generates CREATE_EMOJI operation for a new emoji with role dependency", () => {
      const desired: DiscordConfig = {
        roles: [{ name: "Paladin" }, { name: "Champion" }],
        emojis: [
          {
            name: "mana_potion",
            file: "discord/emojis/mana_potion.png",
            roles: ["Champion"], // Champion is being newly created
          },
        ],
      };

      const diff = computeDiff(desired, mockState);
      const emojiOps = diff.operations.filter((op) => op.resourceType === "emoji");
      expect(emojiOps.length).toBe(1);
      expect(emojiOps[0]?.type).toBe("CREATE_EMOJI");
      expect(emojiOps[0]?.resourceName).toBe(":mana_potion:");

      // Should depend on Champion role creation
      const championRoleOp = diff.operations.find(
        (op) => op.resourceType === "role" && op.resourceName === "Champion",
      );
      expect(championRoleOp).toBeDefined();
      expect(emojiOps[0]?.dependsOn).toContain(championRoleOp?.id);
    });

    it("generates UPDATE_EMOJI when emoji role restrictions change", () => {
      const desired: DiscordConfig = {
        roles: [{ name: "Paladin" }],
        emojis: [
          {
            name: "realm_sword", // exists on server with [Paladin]
            roles: [], // remove restrictions
          },
        ],
      };

      const diff = computeDiff(desired, mockState);
      const emojiOps = diff.operations.filter((op) => op.resourceType === "emoji");
      expect(emojiOps.length).toBe(1);
      expect(emojiOps[0]?.type).toBe("UPDATE_EMOJI");
      expect(emojiOps[0]?.resourceName).toBe(":realm_sword:");
    });

    it("identifies unmanaged emojis (excluding managed ones)", () => {
      const desired: DiscordConfig = {
        roles: [{ name: "Paladin" }],
        emojis: [], // none desired, realm_sword is unmanaged
      };

      const diff = computeDiff(desired, mockState);
      expect(diff.unmanaged.emojis.length).toBe(1);
      expect(diff.unmanaged.emojis[0]?.name).toBe("realm_sword");
      // managedBotEmoji is skipped
      expect(diff.unmanaged.emojis.some((e) => e.name === "bot_icon")).toBe(false);
    });

    it("formats plan output cleanly including Emojis section", () => {
      const plan = generatePlan(
        {
          roles: [{ name: "Paladin" }],
          emojis: [{ name: "mana_potion", file: "discord/emojis/mana_potion.png" }],
        },
        mockState,
      );

      const output = formatPlanOutput(plan);
      expect(output).toContain("Emojis");
      expect(output).toContain(":mana_potion:");
    });
  });

  describe("Executor", () => {
    it("executes CREATE_EMOJI via API with resolved role IDs", async () => {
      const mockClient = {
        createEmoji: vi
          .fn()
          .mockResolvedValue({ id: "emoji_new", name: "mana_potion", roles: ["role_paladin"] }),
      } as unknown as DiscordRestClient;

      const plan: Plan = {
        guildId: "guild_123",
        guildName: "Realm Guild",
        operations: [
          {
            id: "emoji-1",
            type: "CREATE_EMOJI",
            resourceType: "emoji",
            resourceName: ":mana_potion:",
            isDestructive: false,
            description: "Create emoji: :mana_potion:",
            changes: [],
            payload: {
              name: "mana_potion",
              image: "data:image/png;base64,iVBORw0KGgo=",
              roles: ["Paladin"],
              roleMap: { paladin: "role_paladin" },
            },
            dependsOn: [],
          },
        ],
        summary: { create: 1, update: 0, delete: 0, destructive: 0, total: 1 },
        hierarchyWarnings: [],
        unmanaged: { roles: [], categories: [], channels: [], emojis: [] },
      };

      const result = await executePlan(plan, mockClient, { autoApprove: true });
      expect(result.success).toBe(true);
      expect(mockClient.createEmoji).toHaveBeenCalledWith(
        "guild_123",
        {
          name: "mana_potion",
          image: "data:image/png;base64,iVBORw0KGgo=",
          roles: ["role_paladin"],
        },
        expect.any(String),
      );
    });

    it("executes UPDATE_EMOJI and DELETE_EMOJI via API", async () => {
      const mockClient = {
        updateEmoji: vi.fn().mockResolvedValue({ id: "emoji_sword", name: "realm_sword" }),
        deleteEmoji: vi.fn().mockResolvedValue(undefined),
      } as unknown as DiscordRestClient;

      const plan: Plan = {
        guildId: "guild_123",
        guildName: "Realm Guild",
        operations: [
          {
            id: "emoji-update-1",
            type: "UPDATE_EMOJI",
            resourceType: "emoji",
            resourceName: ":realm_sword:",
            resourceId: "emoji_sword",
            isDestructive: false,
            description: "Update emoji: :realm_sword:",
            changes: [],
            payload: {
              name: "realm_sword",
              roles: [],
              roleMap: {},
            },
            dependsOn: [],
          },
          {
            id: "emoji-del-1",
            type: "DELETE_EMOJI",
            resourceType: "emoji",
            resourceName: ":old_emoji:",
            resourceId: "emoji_old",
            isDestructive: true,
            description: "DELETE emoji: :old_emoji:",
            changes: [],
            dependsOn: [],
          },
        ],
        summary: { create: 0, update: 1, delete: 1, destructive: 1, total: 2 },
        hierarchyWarnings: [],
        unmanaged: { roles: [], categories: [], channels: [], emojis: [] },
      };

      const result = await executePlan(plan, mockClient, {
        autoApprove: true,
        allowDestructive: true,
      });
      expect(result.success).toBe(true);
      expect(mockClient.updateEmoji).toHaveBeenCalledWith(
        "guild_123",
        "emoji_sword",
        { name: "realm_sword", roles: [] },
        expect.any(String),
      );
      expect(mockClient.deleteEmoji).toHaveBeenCalledWith(
        "guild_123",
        "emoji_old",
        expect.any(String),
      );
    });
  });

  describe("Wiper", () => {
    it("selects only emojis when emojisOnly is true", () => {
      const targets = selectTargetsToWipe(mockState, undefined, { emojisOnly: true });
      expect(targets.channels.length).toBe(0);
      expect(targets.categories.length).toBe(0);
      expect(targets.roles?.length).toBe(0);
      expect(targets.emojis?.length).toBe(1);
      expect(targets.emojis?.[0]?.name).toBe("realm_sword");
    });

    it("executes emoji deletion during wipe", async () => {
      const mockClient = {
        deleteEmoji: vi.fn().mockResolvedValue(undefined),
      } as unknown as DiscordRestClient;

      const targets = {
        channels: [],
        categories: [],
        roles: [],
        emojis: [existingEmoji],
      };

      const result = await executeWipe(targets, mockClient, { guildId: "guild_123" });
      expect(result.deletedEmojis.length).toBe(1);
      expect(result.deletedEmojis[0]?.name).toBe("realm_sword");
      expect(mockClient.deleteEmoji).toHaveBeenCalledWith(
        "guild_123",
        "emoji_sword",
        expect.any(String),
      );
    });
  });

  describe("Exporter & Verifier", () => {
    it("exports emojis to config and generates emojis.yaml", () => {
      const exported = exportStateToConfig(mockState);
      expect(exported.emojis?.length).toBe(1);
      expect(exported.emojis?.[0]?.name).toBe("realm_sword");
      expect(exported.emojis?.[0]?.roles).toContain("Paladin");

      const exportRes = writeExportFiles(exported, { outputDir: "scratch/test-export" });
      expect(exportRes.filesWritten.some((f) => f.includes("emojis.yaml"))).toBe(true);
    });

    it("verifies state and detects emoji drift", () => {
      // In sync
      const syncConfig: DiscordConfig = {
        roles: [{ name: "Paladin" }],
        emojis: [{ name: "realm_sword", roles: ["Paladin"] }],
      };
      const syncResult = verifyState(syncConfig, mockState);
      expect(syncResult.emojisInSync).toBe(true);

      // Drift: missing emoji
      const driftConfig: DiscordConfig = {
        roles: [{ name: "Paladin" }],
        emojis: [{ name: "realm_sword", roles: ["Paladin"] }, { name: "non_existent_emoji" }],
      };
      const driftResult = verifyState(driftConfig, mockState);
      expect(driftResult.emojisInSync).toBe(false);
      expect(driftResult.inSync).toBe(false);
      expect(
        driftResult.drift.some((d) => d.resourceType === "emoji" && d.field === "existence"),
      ).toBe(true);
    });
  });
});
