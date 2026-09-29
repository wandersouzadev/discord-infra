import { describe, expect, it } from "vitest";
import {
  buildBotGuildContext,
  checkRoleManageability,
} from "../src/discord/hierarchy.js";
import { PERMISSION_FLAGS } from "../src/discord/permissions.js";
import type {
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  DiscordUser,
} from "../src/discord/types.js";

describe("Discord Role Hierarchy", () => {
  const botUser: DiscordUser = {
    id: "bot_123",
    username: "TestBot",
    discriminator: "0001",
  };

  const guild: DiscordGuild = {
    id: "guild_123",
    name: "Test Guild",
    owner_id: "owner_999",
    roles: [],
  };

  const botRole: DiscordRole = {
    id: "role_bot",
    name: "Bot Role",
    color: 0,
    hoist: false,
    position: 10,
    permissions: (
      PERMISSION_FLAGS.manage_roles! | PERMISSION_FLAGS.manage_channels!
    ).toString(),
    managed: true,
    mentionable: false,
  };

  const lowerRole: DiscordRole = {
    id: "role_mod",
    name: "MOD",
    color: 0,
    hoist: true,
    position: 5,
    permissions: "0",
    managed: false,
    mentionable: false,
  };

  const higherRole: DiscordRole = {
    id: "role_admin",
    name: "ADMIN",
    color: 0,
    hoist: true,
    position: 15,
    permissions: "0",
    managed: false,
    mentionable: false,
  };

  const everyoneRole: DiscordRole = {
    id: "guild_123",
    name: "@everyone",
    color: 0,
    hoist: false,
    position: 0,
    permissions: "0",
    managed: false,
    mentionable: false,
  };

  const roles = [everyoneRole, lowerRole, botRole, higherRole];

  const member: DiscordGuildMember = {
    user: botUser,
    roles: [botRole.id],
    joined_at: new Date().toISOString(),
  };

  it("allows bot to manage roles strictly below its highest role position", () => {
    const context = buildBotGuildContext(botUser, guild, member, roles);
    const result = checkRoleManageability(context, lowerRole);
    expect(result.canManage).toBe(true);
  });

  it("blocks bot from managing roles equal to or above its highest role position", () => {
    const context = buildBotGuildContext(botUser, guild, member, roles);
    const result = checkRoleManageability(context, higherRole);
    expect(result.canManage).toBe(false);
    expect(result.reason).toContain("Role hierarchy restriction");
  });

  it("blocks bot from deleting @everyone", () => {
    const context = buildBotGuildContext(botUser, guild, member, roles);
    const result = checkRoleManageability(context, everyoneRole, { isDeleting: true });
    expect(result.canManage).toBe(false);
    expect(result.reason).toContain("Cannot delete the default '@everyone' role");
  });

  it("blocks bot from managing integration-managed roles", () => {
    const context = buildBotGuildContext(botUser, guild, member, roles);
    const result = checkRoleManageability(context, botRole);
    expect(result.canManage).toBe(false);
    expect(result.reason).toContain("automatically managed by a Discord integration");
  });

  it("allows owner bot to manage all roles regardless of position", () => {
    const ownerGuild: DiscordGuild = {
      ...guild,
      owner_id: botUser.id,
    };
    const context = buildBotGuildContext(botUser, ownerGuild, member, roles);
    expect(context.isOwner).toBe(true);

    const result = checkRoleManageability(context, higherRole);
    expect(result.canManage).toBe(true);
  });
});
