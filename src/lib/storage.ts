/**
 * chrome.storage.sync 存储层
 * ---------------------------------------------------------------------------
 * Google 账户同步完全依赖 chrome.storage.sync：只要 Chrome 登录了 Google 账户，
 * 写入这里的数据会自动在所有设备间同步，无需任何后端或 OAuth 配置。
 *
 * 关键约束（Chrome 官方限制）：
 *   - 单个 key 的值最大 8KB（QUOTA_BYTES_PER_ITEM）
 *   - 总容量 100KB（QUOTA_BYTES）
 *
 * v2 存储格式（瘦身 + 压缩）：
 *   - favicon 字段不参与同步（读取端按域名经 Google 图标服务推导，本地缓存于 localStorage），
 *     这是同步数据里占比最大且可完全再生的字段；
 *   - 全量数据 gzip 压缩（CompressionStream）后 base64 切成 <6KB 分片存入
 *     `mn:data:N`，meta.format = 2 标识新格式；
 *   - 兼容读取 v1（明文分片 mn:bm:N / mn:gr:N），首次写入 v2 后清理旧分片。
 *   两项合计可把容量天花板从数百条提升到约 1000~2000 条书签。
 */

import type { AppState, Bookmark, Group, Settings } from '../types';

const PREFIX = 'mn:';
const META_KEY = `${PREFIX}meta`;
const SETTINGS_KEY = `${PREFIX}settings`;
const BM_PREFIX = `${PREFIX}bm:`;
const GR_PREFIX = `${PREFIX}gr:`;
const DATA_PREFIX = `${PREFIX}data:`;
const CHUNK_LIMIT = 6000; // 保守阈值，低于 8KB 官方上限

/** chrome.storage.sync 总配额（字节） */
export const SYNC_QUOTA = 100_000;

interface Meta {
  version: number;
  /** v2 压缩格式的分片数；v1 旧数据仍用 bmChunks/grChunks */
  dataChunks?: number;
  /** 存储格式版本；缺省视为 1 */
  format?: number;
  updatedAt: number;
  deviceId: string;
  /** v1 遗留字段，读取旧数据时使用 */
  bmChunks?: number;
  grChunks?: number;
}

/* ----------------------- gzip 压缩与 base64 ----------------------- */

async function gzipCompress(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function gunzipToText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes.buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 把字符串切成固定长度的分片（用于 base64 载荷） */
function chunkString(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** 同步瘦身：favicon 由读取端推导，不占同步配额 */
function slimBookmarks(bookmarks: Bookmark[]): Bookmark[] {
  return bookmarks.map((b) => ({ ...b, favicon: '' }));
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

/** 从 storage 读取完整应用状态（兼容 v1 明文分片与 v2 压缩格式） */
export async function loadState(): Promise<AppState> {
  const metaObj = await chrome.storage.sync.get(META_KEY);
  const meta = metaObj[META_KEY] as Meta | undefined;
  if (!meta) {
    // 首次安装：写入默认设置，建立 meta
    const settings = { ...DEFAULT_SETTINGS };
    const newMeta: Meta = {
      version: 2,
      format: 2,
      dataChunks: 0,
      updatedAt: Date.now(),
      deviceId: crypto.randomUUID(),
    };
    await chrome.storage.sync.set({
      [META_KEY]: newMeta,
      [SETTINGS_KEY]: settings,
    });
    return { bookmarks: [], groups: [], settings };
  }

  if (meta.format === 2) {
    // v2：压缩分片
    const dataKeys = Array.from({ length: meta.dataChunks ?? 0 }, (_, i) => `${DATA_PREFIX}${i}`);
    const [dataObj, settingsData] = await Promise.all([
      dataKeys.length
        ? chrome.storage.sync.get(dataKeys)
        : Promise.resolve<Record<string, unknown>>({}),
      chrome.storage.sync.get(SETTINGS_KEY),
    ]);
    const b64 = dataKeys.map((k) => (dataObj[k] as string | undefined) ?? '').join('');
    let bookmarks: Bookmark[] = [];
    let groups: Group[] = [];
    if (b64) {
      try {
        const json = await gunzipToText(base64ToBytes(b64));
        const parsed = JSON.parse(json) as { bookmarks?: Bookmark[]; groups?: Group[] };
        bookmarks = parsed.bookmarks ?? [];
        groups = parsed.groups ?? [];
      } catch (err) {
        console.error('decompress sync data failed', err);
      }
    }
    const settings = {
      ...DEFAULT_SETTINGS,
      ...((settingsData[SETTINGS_KEY] as Partial<Settings> | undefined) ?? {}),
    };
    return { bookmarks, groups: normalizeGroups(groups), settings };
  }

  // v1：明文分片（老版本数据）
  const bmKeys = Array.from({ length: meta.bmChunks ?? 0 }, (_, i) => `${BM_PREFIX}${i}`);
  const grKeys = Array.from({ length: meta.grChunks ?? 0 }, (_, i) => `${GR_PREFIX}${i}`);
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

/**
 * 估算完整状态写入 storage.sync 所需的字节数（按 v2 实际压缩流程计算）。
 * 异步：与真实写入同一套瘦身+压缩流程，预检不产生误判。
 */
export async function estimateBytes(state: AppState): Promise<number> {
  const payloadJson = JSON.stringify({
    bookmarks: slimBookmarks(state.bookmarks),
    groups: state.groups,
  });
  const compressed = await gzipCompress(payloadJson);
  const b64 = bytesToBase64(compressed);
  const chunks = Math.max(1, Math.ceil(b64.length / CHUNK_LIMIT));
  return b64.length + chunks * 10 + 150; // key 名与 meta/settings 开销
}

/** 将完整应用状态写回 storage.sync（v2：gzip 压缩分片；写后清理旧格式残留） */
export async function saveState(state: AppState): Promise<number> {
  const now = Date.now();
  const settings: Settings = { ...state.settings, lastSyncedAt: now };

  const metaObj = await chrome.storage.sync.get(META_KEY);
  const oldMeta = metaObj[META_KEY] as Meta | undefined;

  // 瘦身 + 压缩：favicon 不同步，整体 gzip 后 base64 分片
  const payloadJson = JSON.stringify({
    bookmarks: slimBookmarks(state.bookmarks),
    groups: state.groups,
  });
  const compressed = await gzipCompress(payloadJson);
  const b64 = bytesToBase64(compressed);
  const chunks = chunkString(b64, CHUNK_LIMIT);

  const meta: Meta = {
    version: 2,
    format: 2,
    dataChunks: chunks.length,
    updatedAt: now,
    deviceId: oldMeta?.deviceId ?? crypto.randomUUID(),
  };

  const payload: Record<string, unknown> = {
    [SETTINGS_KEY]: settings,
    [META_KEY]: meta,
  };
  chunks.forEach((c, i) => { payload[`${DATA_PREFIX}${i}`] = c; });

  await chrome.storage.sync.set(payload);

  // 清理不再需要的分片：v2 多余分片 + v1 旧格式全部分片
  const staleKeys: string[] = [];
  for (let i = chunks.length; i < (oldMeta?.dataChunks ?? 0); i += 1) {
    staleKeys.push(`${DATA_PREFIX}${i}`);
  }
  if (oldMeta && (oldMeta.format ?? 1) < 2) {
    for (let i = 0; i < (oldMeta.bmChunks ?? 0); i += 1) staleKeys.push(`${BM_PREFIX}${i}`);
    for (let i = 0; i < (oldMeta.grChunks ?? 0); i += 1) staleKeys.push(`${GR_PREFIX}${i}`);
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
  /** v2 为压缩数据分片数；v1 为书签分片数 */
  bmChunks: number;
  grChunks: number;
  /** 存储格式版本：2 = gzip 压缩 */
  format: number;
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
    quota: SYNC_QUOTA,
    bmChunks: meta?.dataChunks ?? meta?.bmChunks ?? 0,
    grChunks: meta?.grChunks ?? 0,
    format: meta?.format ?? 1,
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
