import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DiscordConfig } from "../src/config/types.js";
import {
  generatePreviewHtml,
  preparePreviewData,
  writePreviewHtml,
} from "../src/preview/generator.js";

describe("HTML Preview Generator", () => {
  const sampleConfig: DiscordConfig = {
    roles: [
      {
        name: "Admin",
        color: "#9B59B6",
        hoist: true,
        mentionable: true,
        permissions: ["administrator", "manage_channels"],
      },
      {
        name: "Moderator",
        color: "#3498DB",
        hoist: true,
        mentionable: true,
        permissions: ["kick_members", "ban_members", "manage_messages"],
      },
      {
        name: "Member",
        permissions: ["view_channel", "send_messages"],
      },
    ],
    categories: [
      {
        name: "PUBLIC",
        position: 0,
      },
      {
        name: "SECRET",
        position: 1,
      },
    ],
    channels: [
      {
        name: "general",
        category: "PUBLIC",
        type: "text",
        topic: "General chatter",
        position: 0,
      },
      {
        name: "announcements",
        category: "PUBLIC",
        type: "announcement",
        topic: "Official news",
        position: 1,
      },
      {
        name: "voice-lounge",
        category: "PUBLIC",
        type: "voice",
        position: 2,
      },
      {
        name: "staff-only",
        category: "SECRET",
        type: "text",
        topic: "Confidential staff discussions",
        position: 0,
      },
      {
        name: "sandbox",
        type: "text",
        position: 0,
      },
    ],
    permissions: {
      SECRET: {
        "@everyone": {
          view_channel: false,
        },
        Admin: {
          view_channel: true,
          send_messages: true,
        },
      },
      announcements: {
        "@everyone": {
          send_messages: false,
        },
        Admin: {
          send_messages: true,
        },
      },
    },
  };

  describe("preparePreviewData", () => {
    it("correctly structures categories, channels, and roles", () => {
      const data = preparePreviewData(sampleConfig);

      expect(data.roles).toHaveLength(3);
      expect(data.categories).toHaveLength(2);
      expect(data.uncategorizedChannels).toHaveLength(1);
      expect(data.totalChannels).toBe(5);

      // Check role order (top hierarchy first)
      expect(data.roles[0]?.name).toBe("Admin");
      expect(data.roles[0]?.isAdmin).toBe(true);
      expect(data.roles[0]?.color).toBe("#9B59B6");

      // Check category channels
      const secretCat = data.categories.find((c) => c.name === "SECRET");
      expect(secretCat).toBeDefined();
      expect(secretCat?.channels).toHaveLength(1);
      expect(secretCat?.channels[0]?.name).toBe("staff-only");
      expect(secretCat?.channels[0]?.isPrivate).toBe(true);

      // Uncategorized channel
      expect(data.uncategorizedChannels[0]?.name).toBe("sandbox");
    });

    it("identifies private channels when @everyone view_channel is false", () => {
      const data = preparePreviewData(sampleConfig);
      expect(data.privateChannelsCount).toBe(1); // staff-only
    });
  });

  describe("generatePreviewHtml", () => {
    it("generates valid standalone HTML string containing expected elements", () => {
      const html = generatePreviewHtml(sampleConfig, { title: "Test Guild" });

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Test Guild");
      expect(html).toContain("Admin");
      expect(html).toContain("Moderator");
      expect(html).toContain("PUBLIC");
      expect(html).toContain("SECRET");
      expect(html).toContain("general");
      expect(html).toContain("staff-only");
      expect(html).toContain("#9B59B6");
      expect(html).toContain("General chatter");
      expect(html).toContain("Interactive Permissions Matrix");
    });

    it("handles empty configuration gracefully", () => {
      const emptyConfig: DiscordConfig = {
        roles: [],
        categories: [],
        channels: [],
        permissions: {},
      };

      const html = generatePreviewHtml(emptyConfig);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<strong>0</strong> Categories");
      expect(html).toContain("<strong>0</strong> Channels");
      expect(html).toContain("<strong>0</strong> Roles");
    });
  });

  describe("writePreviewHtml", () => {
    it("writes the preview file to disk successfully", () => {
      const tempPath = resolve("scratch/test-preview.html");

      const result = writePreviewHtml(sampleConfig, {
        output: tempPath,
        title: "Disk Test Guild",
        open: false,
      });

      expect(existsSync(tempPath)).toBe(true);
      expect(result.outputPath).toBe(tempPath);
      expect(result.channelsCount).toBe(5);
      expect(result.rolesCount).toBe(3);
      expect(result.categoriesCount).toBe(2);

      // Cleanup
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    });
  });
});
