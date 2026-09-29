import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loader.js";
import {
  numberToHexColor,
  parseColorToNumber,
  validateReferentialIntegrity,
} from "../src/config/schema.js";
import type { DiscordConfig } from "../src/config/types.js";
import { ConfigValidationError } from "../src/utils/errors.js";

describe("Configuration and Schema Validation", () => {
  describe("Color Conversion", () => {
    it("converts hex strings to numbers correctly", () => {
      expect(parseColorToNumber("#9B59B6")).toBe(0x9b59b6);
      expect(parseColorToNumber("3498DB")).toBe(0x3498db);
      expect(parseColorToNumber(undefined)).toBeUndefined();
    });

    it("rejects invalid hex strings", () => {
      expect(() => parseColorToNumber("not-a-color")).toThrow();
      expect(() => parseColorToNumber("#ZZZZZZ")).toThrow();
      expect(() => parseColorToNumber("#12345")).toThrow();
    });

    it("converts integer back to formatted hex color", () => {
      expect(numberToHexColor(0x9b59b6)).toBe("#9B59B6");
      expect(numberToHexColor(0)).toBeUndefined();
    });
  });

  describe("Referential Integrity", () => {
    it("detects duplicate role names", () => {
      const config: DiscordConfig = {
        roles: [{ name: "MOD" }, { name: "mod" }],
        categories: [],
        channels: [],
      };
      expect(() => validateReferentialIntegrity(config)).toThrow(ConfigValidationError);
    });

    it("detects duplicate category names", () => {
      const config: DiscordConfig = {
        roles: [{ name: "MOD" }],
        categories: [{ name: "STAFF" }, { name: "staff" }],
        channels: [],
      };
      expect(() => validateReferentialIntegrity(config)).toThrow(ConfigValidationError);
    });

    it("detects duplicate channel names within the same category", () => {
      const config: DiscordConfig = {
        roles: [],
        categories: [{ name: "COMMUNITY" }],
        channels: [
          { name: "general", category: "COMMUNITY" },
          { name: "general", category: "COMMUNITY" },
        ],
      };
      expect(() => validateReferentialIntegrity(config)).toThrow(ConfigValidationError);
    });

    it("allows same channel name in different categories", () => {
      const config: DiscordConfig = {
        roles: [],
        categories: [{ name: "COMMUNITY" }, { name: "SUPPORT" }],
        channels: [
          { name: "faq", category: "COMMUNITY" },
          { name: "faq", category: "SUPPORT" },
        ],
      };
      expect(() => validateReferentialIntegrity(config)).not.toThrow();
    });

    it("flags channel referencing non-existent category", () => {
      const config: DiscordConfig = {
        roles: [],
        categories: [{ name: "COMMUNITY" }],
        channels: [{ name: "bug-reports", category: "NON_EXISTENT_CATEGORY" }],
      };
      expect(() => validateReferentialIntegrity(config)).toThrow(ConfigValidationError);
    });

    it("flags permission targeting non-existent target or unknown role", () => {
      const config: DiscordConfig = {
        roles: [{ name: "MOD" }],
        categories: [{ name: "STAFF" }],
        channels: [],
        permissions: {
          UNKNOWN_TARGET: {
            MOD: { view_channel: true },
          },
        },
      };
      expect(() => validateReferentialIntegrity(config)).toThrow(ConfigValidationError);

      const configUnknownRole: DiscordConfig = {
        roles: [{ name: "MOD" }],
        categories: [{ name: "STAFF" }],
        channels: [],
        permissions: {
          STAFF: {
            UNKNOWN_ROLE: { view_channel: true },
          },
        },
      };
      expect(() => validateReferentialIntegrity(configUnknownRole)).toThrow(ConfigValidationError);
    });

    it("allows valid configuration with @everyone and defined roles", () => {
      const config: DiscordConfig = {
        roles: [{ name: "GM" }, { name: "MOD" }],
        categories: [{ name: "STAFF" }],
        channels: [{ name: "staff-chat", category: "STAFF" }],
        permissions: {
          STAFF: {
            "@everyone": { view_channel: false },
            MOD: { view_channel: true, send_messages: true },
          },
        },
      };
      expect(() => validateReferentialIntegrity(config)).not.toThrow();
    });
  });

  describe("Config Loader", () => {
    it("throws when configuration path does not exist", () => {
      expect(() => loadConfig({ configPath: "non/existent/path" })).toThrow(ConfigValidationError);
    });
  });
});
