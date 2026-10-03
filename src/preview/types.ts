export interface PreviewOptions {
  title?: string;
  configPath?: string;
}

export interface PreviewFileOptions extends PreviewOptions {
  output?: string;
  open?: boolean;
}

export interface PreviewResult {
  outputPath: string;
  html: string;
  rolesCount: number;
  categoriesCount: number;
  channelsCount: number;
  privateChannelsCount: number;
  emojisCount?: number;
}

export interface ResolvedChannelPermission {
  roleName: string;
  roleColor?: string;
  isInherited: boolean;
  allow: string[];
  deny: string[];
  canView: boolean;
  canSend: boolean;
}

export interface ChannelPreviewData {
  name: string;
  category?: string;
  type: string;
  topic?: string;
  position?: number;
  slowmode?: number;
  isPrivate: boolean;
  permissions: ResolvedChannelPermission[];
}

export interface CategoryPreviewData {
  name: string;
  position?: number;
  channels: ChannelPreviewData[];
  permissions: ResolvedChannelPermission[];
}

export interface RolePreviewData {
  name: string;
  color?: string;
  hoist: boolean;
  mentionable: boolean;
  position: number;
  isAdmin: boolean;
  permissions: string[];
  channelOverridesCount: number;
}
