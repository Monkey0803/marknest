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
  /** 回收站：软删除时间戳。有值表示已进入回收站，常规视图不展示 */
  deletedAt?: number;
  /** 分层存储：冷数据下沉到 chrome.storage.local 后仍保留在 state 中，此标记用于统计与展示 */
  archived?: boolean;
  /** 来源：浏览器书签增量同步的源节点 id，用于识别与更新同源书签 */
  browserId?: string;
}

/** 浏览器书签增量同步：把 Chrome 书签树的变更合并进扩展 */
export interface BrowserSyncState {
  /** 是否开启自动增量同步 */
  enabled: boolean;
  /** 上次成功合并的时间 */
  lastSyncedAt: number;
  /** 自动把浏览器书签文件夹映射为扩展分组 */
  syncFolders: boolean;
  /** 浏览器里删除的书签是否同步进回收站（默认 true，可恢复） */
  syncRemovals: boolean;
  /** 浏览器文件夹 id → 扩展分组 id 映射（增量同步识别归属） */
  folderMap: Record<string, string>;
}

/** 智能文件夹（保存的搜索）：把一组查询条件保存为虚拟分组 */
export interface SmartFolder {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  order: number;
  /** 查询表达式，如 `tag:设计 domain:figma.com 未读` */
  query: string;
}

/** 自动打标签规则：收藏时命中域名或关键词则自动追加标签 */
export interface AutoTagRule {
  id: string;
  /** 匹配类型：域名（精确/后缀）或关键词（标题/网址包含） */
  kind: 'domain' | 'keyword';
  /** 匹配值；域名支持写 www 前缀无关，关键词大小写不敏感 */
  pattern: string;
  /** 命中后自动追加的标签 */
  tags: string[];
  createdAt: number;
}

/** 死链巡检配置与结果 */
export interface HealthMonitor {
  /** 是否开启后台定期检测 */
  enabled: boolean;
  /** 检测间隔（小时） */
  intervalHours: number;
  /** 上次检测时间 */
  lastRunAt: number;
  /** 上次检测发现的死链书签 id（用于角标提示） */
  deadIds: string[];
}

/** 分层存储配置：把长期未访问的书签下沉到 chrome.storage.local */
export interface ArchiveConfig {
  /** 超过多少天未访问视为冷数据；0 表示关闭自动归档 */
  idleDays: number;
  /** 上次归档时间 */
  lastRunAt: number;
}

/** 快捷键绑定：动作 id -> 组合键描述（与 App 键盘处理对应） */
export type ShortcutBindings = Record<string, string>;

/** 搜索历史条目 */
export interface SearchHistoryItem {
  query: string;
  at: number;
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
  /** 私密分组：需输入 PIN 才能查看其中的书签 */
  private?: boolean;
}

export interface Settings {
  theme: ThemeMode;
  view: ViewMode;
  sort: SortMode;
  /** 每次写入后更新时间戳，用于同步状态展示 */
  lastSyncedAt: number;
  /** 安装时间 */
  installedAt: number;
  /** 收藏时自动清理 utm 系列与 fbclid 等追踪参数 */
  stripTracking: boolean;
  /** 浏览器书签增量同步 */
  browserSync: BrowserSyncState;
  /** 智能文件夹 */
  smartFolders: SmartFolder[];
  /** 自动打标签规则 */
  autoTagRules: AutoTagRule[];
  /** 死链巡检 */
  healthMonitor: HealthMonitor;
  /** 分层存储 */
  archive: ArchiveConfig;
  /** 快捷键自定义（缺省时用内置默认值） */
  shortcuts: ShortcutBindings;
  /** 最近搜索词（最多 20 条） */
  searchHistory: SearchHistoryItem[];
  /** 私密分组 PIN（简单哈希，非安全级别，仅防误看） */
  pinHash?: string;
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
