/**
 * chrome.storage.sync 存储层
 * ---------------------------------------------------------------------------
 * Google 账户同步完全依赖 chrome.storage.sync：只要 Chrome 登录了 Google 账户，
 * 写入这里的数据会自动在所有设备间同步，无需任何后端或 OAuth 配置。
 *
 * 关键约束（Chrome 官方限制）：
 *   - 单个 key 的值最大 8KB（QUOTA_BYTES_PER_ITEM）
 *   - 总容量 100KB（QUOTA_BYTES）
 * 因此书签与分组采用“分片”存储：把数组切分为若干个 < 6KB 的块分别存放，
 * 从而突破单条 8KB 限制，可容纳数百条书签。
 */

import type { AppState, Bookmark, Group, Settings } from '../types';

const PREFIX = 'mn:';
const META_KEY = `${PREFIX}meta`;
const SETTINGS_KEY = `${PREFIX}settings`;
const BM_PREFIX = `${PREFIX}bm:`;
const GR_PREFIX = `${PREFIX}gr:`;
const CHUNK_LIMIT = 6000; // 保守阈值，低于 8KB 官方上限

const encoder = new TextEncoder();
const byteLen = (value: string) => encoder.encode(value).length;

interface Meta {
  version: number;
  bmChunks: number;
  grChunks: number;
  updatedAt: number;
  deviceId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  view: 'list',
  sort: 'manual',
  lastSyncedAt: 0,
  installedAt: Date.now(),
};

export function defaultState(): AppState {
  return { bookmarks: [], groups: [], settings: { ...DEFAULT_SETTINGS } };
}

/** 将数组切分为序列化后字节数受限的多个分片 */
function chunkByBytes<T>(items: T[], prefix: string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  let current: T[] = [];
  let index = 0;

  for (const item of items) {
    const candidate = [...current, item];
    if (current.length > 0 && byteLen(JSON.stringify(candidate)) > CHUNK_LIMIT) {
      result[`${prefix}${index}`] = current;
      index += 1;
      current = [item];
    } else {
      current = candidate;
    }
  }
  result[`${prefix}${index}`] = current;
  return result;
}

/** 从 storage 读取完整应用状态 */
export async function loadState(): Promise<AppState> {
  const metaObj = await chrome.storage.sync.get(META_KEY);
  const meta = metaObj[META_KEY] as Meta | undefined;
  if (!meta) {
    // 首次安装：写入默认设置，建立 meta
    const settings = { ...DEFAULT_SETTINGS };
    const newMeta: Meta = {
      version: 1,
      bmChunks: 0,
      grChunks: 0,
      updatedAt: Date.now(),
      deviceId: crypto.randomUUID(),
    };
    await chrome.storage.sync.set({
      [META_KEY]: newMeta,
      [SETTINGS_KEY]: settings,
    });
    return { bookmarks: [], groups: [], settings };
  }

  const bmKeys = Array.from({ length: meta.bmChunks }, (_, i) => `${BM_PREFIX}${i}`);
  const grKeys = Array.from({ length: meta.grChunks }, (_, i) => `${GR_PREFIX}${i}`);
  const [bmData, grData, settingsData] = await Promise.all([
    bmKeys.length
      ? chrome.storage.sync.get(bmKeys)
      : Promise.resolve<Record<string, unknown>>({}),
    grKeys.length
      ? chrome.storage.sync.get(grKeys)
      : Promise.resolve<Record<string, unknown>>({}),
    chrome.storage.sync.get(SETTINGS_KEY),
  ]);

  const bookmarks: Bookmark[] = bmKeys.flatMap(
    (key) => (bmData[key] as Bookmark[] | undefined) ?? [],
  );
  const rawGroups: Group[] = grKeys.flatMap(
    (key) => (grData[key] as Group[] | undefined) ?? [],
  );
  const groups = normalizeGroups(rawGroups);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...((settingsData[SETTINGS_KEY] as Partial<Settings> | undefined) ?? {}),
  };

  return { bookmarks, groups, settings };
}

/**
 * 分组数据修复：老版本没有 parentId 字段，或同步过程中出现指向已删除分组的父引用。
 * 统一补全 parentId 并断开非法/成环的父子关系，避免侧栏递归渲染出问题。
 */
export function normalizeGroups(raw: Group[]): Group[] {
  const byId = new Map(raw.map((g) => [g.id, g]));
  return raw.map((g) => {
    const pid = g.parentId ?? null;
    if (!pid || pid === g.id || !byId.has(pid)) return { ...g, parentId: null };
    // 断开环：向上追溯若遇到自己，则提升为顶层
    const seen = new Set<string>([g.id]);
    let cur: Group | undefined = byId.get(pid);
    while (cur) {
      if (seen.has(cur.id)) return { ...g, parentId: null };
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return { ...g, parentId: pid };
  });
}

/** 将完整应用状态写回 storage.sync（自动分片 + 清理旧分片） */
export async function saveState(state: AppState): Promise<number> {
  const now = Date.now();
  const settings: Settings = { ...state.settings, lastSyncedAt: now };

  const bmChunks = chunkByBytes(state.bookmarks, BM_PREFIX);
  const grChunks = chunkByBytes(state.groups, GR_PREFIX);

  const metaObj = await chrome.storage.sync.get(META_KEY);
  const oldMeta = metaObj[META_KEY] as Meta | undefined;

  const meta: Meta = {
    version: 1,
    bmChunks: Object.keys(bmChunks).length,
    grChunks: Object.keys(grChunks).length,
    updatedAt: now,
    deviceId: oldMeta?.deviceId ?? crypto.randomUUID(),
  };

  const payload: Record<string, unknown> = {
    ...bmChunks,
    ...grChunks,
    [SETTINGS_KEY]: settings,
    [META_KEY]: meta,
  };

  await chrome.storage.sync.set(payload);

  // 删除不再需要的旧分片，避免残留数据占用配额
  const staleKeys: string[] = [];
  for (let i = meta.bmChunks; i < (oldMeta?.bmChunks ?? 0); i += 1) {
    staleKeys.push(`${BM_PREFIX}${i}`);
  }
  for (let i = meta.grChunks; i < (oldMeta?.grChunks ?? 0); i += 1) {
    staleKeys.push(`${GR_PREFIX}${i}`);
  }
  if (staleKeys.length) await chrome.storage.sync.remove(staleKeys);

  return now;
}

/** 查询当前同步存储占用字节数（用于配额提示） */
export async function getUsage(): Promise<{ bytes: number; quota: number }> {
  const bytes = await chrome.storage.sync.getBytesInUse(null);
  return { bytes, quota: 100_000 };
}

/** 同步诊断信息：扩展 ID（跨设备必须一致）+ 云端分区概览 */
export interface SyncDiagnostic {
  extensionId: string;
  bytes: number;
  quota: number;
  bmChunks: number;
  grChunks: number;
  updatedAt: number;
  deviceId: string;
}

export async function getDiagnostic(): Promise<SyncDiagnostic> {
  const [bytes, metaObj] = await Promise.all([
    chrome.storage.sync.getBytesInUse(null),
    chrome.storage.sync.get(META_KEY),
  ]);
  const meta = metaObj[META_KEY] as Meta | undefined;
  return {
    extensionId: chrome.runtime.id,
    bytes,
    quota: 100_000,
    bmChunks: meta?.bmChunks ?? 0,
    grChunks: meta?.grChunks ?? 0,
    updatedAt: meta?.updatedAt ?? 0,
    deviceId: meta?.deviceId ?? '',
  };
}

/** 监听其他设备/标签页带来的数据变化 */
export function onExternalChange(callback: () => void): () => void {
  const handler = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ) => {
    if (areaName !== 'sync') return;
    // 只关心我们写入的键，忽略其他扩展数据
    const relevant = Object.keys(changes).some((key) => key.startsWith(PREFIX));
    if (relevant) callback();
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
