import type { ChannelType } from "../discord/types.js";

export type OperationType =
  | "CREATE_ROLE"
  | "UPDATE_ROLE"
  | "REORDER_ROLES"
  | "DELETE_ROLE"
  | "CREATE_CATEGORY"
  | "UPDATE_CATEGORY"
  | "REORDER_CATEGORIES"
  | "DELETE_CATEGORY"
  | "CREATE_CHANNEL"
  | "UPDATE_CHANNEL"
  | "MOVE_CHANNEL"
  | "REORDER_CHANNELS"
  | "DELETE_CHANNEL"
  | "SET_PERMISSIONS"
  | "DELETE_PERMISSIONS";

export type ResourceType = "role" | "category" | "channel" | "permission";

export interface PropertyChange {
  property: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface Operation {
  id: string;
  type: OperationType;
  resourceType: ResourceType;
  resourceName: string;
  resourceId?: string; // Existing Discord Snowflake or placeholder
  isDestructive: boolean;
  description: string;
  changes: PropertyChange[];
  payload?: unknown;
  dependsOn: string[]; // List of operation IDs that must complete first
}

export interface PlanSummary {
  create: number;
  update: number;
  delete: number;
  destructive: number;
  total: number;
}

export interface UnmanagedResources {
  roles: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; name: string; category?: string }>;
}

export interface Plan {
  guildId: string;
  guildName: string;
  operations: Operation[];
  summary: PlanSummary;
  hierarchyWarnings: string[];
  unmanaged: UnmanagedResources;
}

export interface ResolvedResourceMap {
  rolesByName: Map<string, string>; // lower name -> discord role id
  rolesById: Map<string, string>;
  categoriesByName: Map<string, string>; // lower name -> discord category id
  categoriesById: Map<string, string>;
  channelsByName: Map<string, string>; // 'category:channel' -> discord channel id
}

export interface ChannelOperationPayload {
  name: string;
  type?: ChannelType;
  topic?: string;
  parentId?: string;
  parentCategoryName?: string;
  position?: number;
  slowmode?: number;
}

export interface PermissionOperationPayload {
  targetId?: string; // channel or category snowflake
  targetName: string;
  targetType: "category" | "channel";
  roleName: string;
  roleId?: string;
  allow: string;
  deny: string;
  type: number; // 0 = role
}
