/** 数据模型定义 —— 所有状态都存于 chrome.storage.sync（跟随 Google 账户同步） */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ViewMode = 'grid' | 'list';
export type SortMode = 'manual' | 'recent' | 'title' | 'visits';

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  description: string;
  groupId: string | null;
  tags: string[];
  favicon: string;
  createdAt: number;
  updatedAt: number;
  visitedAt: number;
  visits: number;
  pinned: boolean;
  /** 阅读清单：true 表示稍后阅读；打开链接后自动清除 */
  readLater?: boolean;
  /** 标记已读 / 移出阅读清单的时间 */
  readAt?: number;
  /** 手动排序时的序号，越小越靠前 */
  order: number;
}

export interface Group {
  id: string;
  name: string;
  /** 十六进制颜色，如 #6a9bcc */
  color: string;
  createdAt: number;
  order: number;
  /** 父分组 id；null 表示顶层分组（支持无限层级嵌套） */
  parentId: string | null;
}

export interface Settings {
  theme: ThemeMode;
  view: ViewMode;
  sort: SortMode;
  /** 每次写入后更新时间戳，用于同步状态展示 */
  lastSyncedAt: number;
  /** 安装时间 */
  installedAt: number;
}

export interface AppState {
  bookmarks: Bookmark[];
  groups: Group[];
  settings: Settings;
}

export type SyncPhase = 'idle' | 'syncing' | 'synced' | 'error' | 'local';

export interface SyncStatus {
  phase: SyncPhase;
  message: string;
  lastSyncedAt: number;
}
