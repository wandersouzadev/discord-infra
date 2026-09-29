import { describe, expect, it, vi } from "vitest";
import type { DiscordRestClient } from "../src/discord/client.js";
import { executePlan } from "../src/executor/executor.js";
import type { Plan } from "../src/planner/types.js";
import { SafetyError } from "../src/utils/errors.js";

describe("Executor Engine", () => {
  const mockPlan: Plan = {
    guildId: "guild_123",
    guildName: "Test Guild",
    operations: [
      {
        id: "role-1",
        type: "CREATE_ROLE",
        resourceType: "role",
        resourceName: "SUPPORT",
        isDestructive: false,
        description: "Create role: SUPPORT",
        changes: [],
        payload: { name: "SUPPORT", color: 0 },
        dependsOn: [],
      },
      {
        id: "cat-1",
        type: "CREATE_CATEGORY",
        resourceType: "category",
        resourceName: "SUPPORT",
        isDestructive: false,
        description: "Create category: SUPPORT",
        changes: [],
        payload: { name: "SUPPORT" },
        dependsOn: [],
      },
    ],
    summary: {
      create: 2,
      update: 0,
      delete: 0,
      destructive: 0,
      total: 2,
    },
    hierarchyWarnings: [],
    unmanaged: { roles: [], categories: [], channels: [] },
  };

  it("executes operations in dry-run mode without calling API", async () => {
    const mockClient = {} as DiscordRestClient;
    const result = await executePlan(mockPlan, mockClient, { dryRun: true });

    expect(result.success).toBe(true);
    expect(result.completed.length).toBe(2);
    expect(result.unexecuted.length).toBe(0);
  });

  it("executes operations successfully and maps created resources", async () => {
    const mockClient = {
      createRole: vi.fn().mockResolvedValue({ id: "new_role_999", name: "SUPPORT" }),
      createChannel: vi.fn().mockResolvedValue({ id: "new_cat_888", name: "SUPPORT" }),
    } as unknown as DiscordRestClient;

    const result = await executePlan(mockPlan, mockClient, { autoApprove: true });

    expect(result.success).toBe(true);
    expect(result.completed.length).toBe(2);
    expect(mockClient.createRole).toHaveBeenCalledWith(
      "guild_123",
      { name: "SUPPORT", color: 0 },
      expect.any(String),
    );
  });

  it("halts execution immediately when an operation fails and reports status", async () => {
    const mockClient = {
      createRole: vi.fn().mockResolvedValue({ id: "new_role_999", name: "SUPPORT" }),
      createChannel: vi.fn().mockRejectedValue(new Error("Missing MANAGE_CHANNELS permission")),
    } as unknown as DiscordRestClient;

    const result = await executePlan(mockPlan, mockClient, { autoApprove: true });

    expect(result.success).toBe(false);
    expect(result.completed.length).toBe(1);
    expect(result.completed[0]?.operation.type).toBe("CREATE_ROLE");
    expect(result.failed?.operation.type).toBe("CREATE_CATEGORY");
    expect(result.failed?.error).toContain("Missing MANAGE_CHANNELS");
    expect(result.unexecuted.length).toBe(0);
  });

  it("blocks destructive operations if allowDestructive is false", async () => {
    const destructivePlan: Plan = {
      ...mockPlan,
      operations: [
        {
          id: "del-1",
          type: "DELETE_CHANNEL",
          resourceType: "channel",
          resourceName: "#old-chan",
          resourceId: "chan_999",
          isDestructive: true,
          description: "DELETE channel: #old-chan",
          changes: [],
          dependsOn: [],
        },
      ],
      summary: {
        create: 0,
        update: 0,
        delete: 1,
        destructive: 1,
        total: 1,
      },
    };

    const mockClient = {} as DiscordRestClient;

    await expect(
      executePlan(destructivePlan, mockClient, {
        allowDestructive: false,
        autoApprove: true,
      }),
    ).rejects.toThrow(SafetyError);
  });
});
