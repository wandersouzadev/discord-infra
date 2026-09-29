import type { DiscordRestClient } from "./client.js";
import { buildBotGuildContext, type BotGuildContext } from "./hierarchy.js";
import { ChannelType, type DiscordChannel, type DiscordGuild, type DiscordRole } from "./types.js";

export interface DiscordServerState {
  guild: DiscordGuild;
  botContext: BotGuildContext;
  roles: DiscordRole[];
  categories: DiscordChannel[];
  channels: DiscordChannel[];
  rolesByName: Map<string, DiscordRole>;
  rolesById: Map<string, DiscordRole>;
  categoriesByName: Map<string, DiscordChannel>;
  categoriesById: Map<string, DiscordChannel>;
  channelsByName: Map<string, DiscordChannel[]>; // multiple channels can share names in different categories
  channelsById: Map<string, DiscordChannel>;
}

/**
 * Fetch the complete current state of a Discord guild.
 */
export async function fetchDiscordState(
  client: DiscordRestClient,
  guildId: string,
): Promise<DiscordServerState> {
  const [guild, currentUser, rawRoles, rawChannels] = await Promise.all([
    client.getGuild(guildId),
    client.getCurrentUser(),
    client.getRoles(guildId),
    client.getChannels(guildId),
  ]);

  const botMember = await client.getGuildMember(guildId, currentUser.id);

  // Separate channels and categories
  const categories = rawChannels
    .filter((c) => c.type === ChannelType.GUILD_CATEGORY)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const channels = rawChannels
    .filter((c) => c.type !== ChannelType.GUILD_CATEGORY)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Build lookups
  const rolesByName = new Map<string, DiscordRole>();
  const rolesById = new Map<string, DiscordRole>();
  for (const role of rawRoles) {
    rolesByName.set(role.name.toLowerCase(), role);
    rolesById.set(role.id, role);
  }

  const categoriesByName = new Map<string, DiscordChannel>();
  const categoriesById = new Map<string, DiscordChannel>();
  for (const cat of categories) {
    if (cat.name) {
      categoriesByName.set(cat.name.toLowerCase(), cat);
    }
    categoriesById.set(cat.id, cat);
  }

  const channelsByName = new Map<string, DiscordChannel[]>();
  const channelsById = new Map<string, DiscordChannel>();
  for (const chan of channels) {
    if (chan.name) {
      const lower = chan.name.toLowerCase();
      const existing = channelsByName.get(lower) ?? [];
      existing.push(chan);
      channelsByName.set(lower, existing);
    }
    channelsById.set(chan.id, chan);
  }

  const botContext = buildBotGuildContext(currentUser, guild, botMember, rawRoles);

  return {
    guild,
    botContext,
    roles: rawRoles,
    categories,
    channels,
    rolesByName,
    rolesById,
    categoriesByName,
    categoriesById,
    channelsByName,
    channelsById,
  };
}
