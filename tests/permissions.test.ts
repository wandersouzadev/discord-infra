import { describe, expect, it } from "vitest";
import {
  bitfieldToPermissions,
  hasPermission,
  isValidPermission,
  normalizePermissionName,
  permissionMapToOverwrites,
  permissionsToBitfield,
  overwritesToPermissionMap,
  PERMISSION_FLAGS,
} from "../src/discord/permissions.js";

describe("Discord Permissions", () => {
  it("normalizes permission names consistently", () => {
    expect(normalizePermissionName("VIEW_CHANNEL")).toBe("view_channel");
    expect(normalizePermissionName("send messages")).toBe("send_messages");
    expect(normalizePermissionName(" manage_roles ")).toBe("manage_roles");
  });

  it("identifies valid vs invalid permissions", () => {
    expect(isValidPermission("view_channel")).toBe(true);
    expect(isValidPermission("ADMINISTRATOR")).toBe(true);
    expect(isValidPermission("send_messages")).toBe(true);
    expect(isValidPermission("fake_unknown_permission")).toBe(false);
  });

  it("converts permission name list to bitfield string and back", () => {
    const perms = ["view_channel", "send_messages", "embed_links"];
    const bitfield = permissionsToBitfield(perms);
    expect(typeof bitfield).toBe("string");

    const decoded = bitfieldToPermissions(bitfield);
    expect(decoded).toContain("view_channel");
    expect(decoded).toContain("send_messages");
    expect(decoded).toContain("embed_links");
    expect(decoded).not.toContain("administrator");
  });

  it("converts human-readable permission map to overwrites bitfields and back", () => {
    const inputMap = {
      view_channel: true,
      send_messages: true,
      manage_messages: false,
    };

    const { allow, deny } = permissionMapToOverwrites(inputMap);

    const allowBig = BigInt(allow);
    const denyBig = BigInt(deny);

    expect((allowBig & PERMISSION_FLAGS.view_channel!).toString()).toBe(
      PERMISSION_FLAGS.view_channel!.toString(),
    );
    expect((allowBig & PERMISSION_FLAGS.send_messages!).toString()).toBe(
      PERMISSION_FLAGS.send_messages!.toString(),
    );
    expect((denyBig & PERMISSION_FLAGS.manage_messages!).toString()).toBe(
      PERMISSION_FLAGS.manage_messages!.toString(),
    );

    // Round-trip check
    const roundTrip = overwritesToPermissionMap(allow, deny);
    expect(roundTrip.view_channel).toBe(true);
    expect(roundTrip.send_messages).toBe(true);
    expect(roundTrip.manage_messages).toBe(false);
  });

  it("checks individual permissions and handles administrator override", () => {
    const adminBitfield = PERMISSION_FLAGS.administrator!.toString();
    expect(hasPermission(adminBitfield, "view_channel")).toBe(true);
    expect(hasPermission(adminBitfield, "manage_roles")).toBe(true);

    const normalBitfield = PERMISSION_FLAGS.view_channel!.toString();
    expect(hasPermission(normalBitfield, "view_channel")).toBe(true);
    expect(hasPermission(normalBitfield, "manage_roles")).toBe(false);
  });
});
