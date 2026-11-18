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
 *
 * v3 存储格式（增量同步）：
 *   - 书签按 order 稳定排序后切成多个独立分组（每组 gzip 压缩，存 `mn:bg:N`）；
 *   - 写入前与云端现有分片逐 key 比对，只写变化的分片——单条书签的新增/编辑
 *     通常只写 1~2 个分片，大幅减少写入量，也避开 sync 的写入频率限制；
 *   - 分组（文件夹）数量少，整体压缩存 `mn:grp:N`；
 *   - 兼容读取 v1 / v2，首次写入 v3 后清理旧格式分片。
 *   两项压缩合计可把容量天花板提升到约 1000~2000 条书签。
 */

import type { AppState, Bookmark, Group, Settings } from '../types';

const PREFIX = 'mn:';
const META_KEY = `${PREFIX}meta`;
const SETTINGS_KEY = `${PREFIX}settings`;
const BM_PREFIX = `${PREFIX}bm:`;
const GR_PREFIX = `${PREFIX}gr:`;
const DATA_PREFIX = `${PREFIX}data:`;
const BG_PREFIX = `${PREFIX}bg:`;
const GRP_PREFIX = `${PREFIX}grp:`;
const CHUNK_LIMIT = 6000; // 保守阈值，低于 8KB 官方上限
/** v3 书签分组的原始字节目标值：约 50 条/组，压缩后 base64 约 4~5KB（低于单 key 限制） */
const GROUP_RAW_LIMIT = 20_000;

/** chrome.storage.sync 总配额（字节） */
export const SYNC_QUOTA = 100_000;

interface Meta {
  version: number;
  /** v2 压缩格式的分片数 */
  dataChunks?: number;
  /** v3 书签分组数 */
  bmGroups?: number;
  /** v3 分组（文件夹）数据分片数 */
  grpChunks?: number;
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

const encoder = new TextEncoder();
const byteLen = (value: string) => encoder.encode(value).length;

/** v3 载荷：书签分组与分组（文件夹）数据的 base64 分片 */
interface V3Payload {
  bmChunks: string[];
  grpChunks: string[];
}

/**
 * 构建 v3 载荷：书签按 order 稳定排序、切组、逐组 gzip。
 * 新书签 order 最大、排在末尾 → 通常只影响最后一个分组，利于增量写入。
 */
async function buildV3Payload(state: AppState): Promise<V3Payload> {
  const slim = slimBookmarks(state.bookmarks)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);

  // 按原始字节累积分组
  const groups: Bookmark[][] = [];
  let current: Bookmark[] = [];
  for (const bm of slim) {
    current.push(bm);
    if (byteLen(JSON.stringify(current)) >= GROUP_RAW_LIMIT) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);

  // 逐组压缩；单组 base64 超限时对半拆分重试（极长单条书签则退化为字符串切块）
  const bmChunks: string[] = [];
  const packList = async (list: Bookmark[]): Promise<void> => {
    const b64 = bytesToBase64(await gzipCompress(JSON.stringify(list)));
    if (b64.length <= CHUNK_LIMIT) {
      bmChunks.push(b64);
      return;
    }
    if (list.length <= 1) {
      bmChunks.push(...chunkString(b64, CHUNK_LIMIT));
      return;
    }
    const mid = Math.ceil(list.length / 2);
    await packList(list.slice(0, mid));
    await packList(list.slice(mid));
  };
  for (const g of groups) await packList(g);

  // 分组（文件夹）数量少：整体压缩，超限才切块
  const grpB64 = bytesToBase64(await gzipCompress(JSON.stringify(state.groups)));
  const grpChunks = grpB64.length <= CHUNK_LIMIT ? [grpB64] : chunkString(grpB64, CHUNK_LIMIT);

  return { bmChunks, grpChunks };
}

/** 从 storage 读取完整应用状态（兼容 v1 明文分片 / v2 整体压缩 / v3 分组压缩） */
export async function loadState(): Promise<AppState> {
  const metaObj = await chrome.storage.sync.get(META_KEY);
  const meta = metaObj[META_KEY] as Meta | undefined;
  if (!meta) {
    // 首次安装：写入默认设置，建立 meta
    const settings = { ...DEFAULT_SETTINGS };
    const newMeta: Meta = {
      version: 3,
      format: 3,
      bmGroups: 0,
      grpChunks: 0,
      updatedAt: Date.now(),
      deviceId: crypto.randomUUID(),
    };
    await chrome.storage.sync.set({
      [META_KEY]: newMeta,
      [SETTINGS_KEY]: settings,
    });
    return { bookmarks: [], groups: [], settings };
  }

  const settingsData = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...((settingsData[SETTINGS_KEY] as Partial<Settings> | undefined) ?? {}),
  };

  if (meta.format === 3) {
    // v3：书签分组各自独立 gzip，分组（文件夹）为单流切块
    const bgKeys = Array.from({ length: meta.bmGroups ?? 0 }, (_, i) => `${BG_PREFIX}${i}`);
    const grpKeys = Array.from({ length: meta.grpChunks ?? 0 }, (_, i) => `${GRP_PREFIX}${i}`);
    const [bgData, grpData] = await Promise.all([
      bgKeys.length ? chrome.storage.sync.get(bgKeys) : Promise.resolve<Record<string, unknown>>({}),
      grpKeys.length ? chrome.storage.sync.get(grpKeys) : Promise.resolve<Record<string, unknown>>({}),
    ]);
    let bookmarks: Bookmark[] = [];
    let groups: Group[] = [];
    try {
      for (const key of bgKeys) {
        const b64 = bgData[key] as string | undefined;
        if (!b64) continue;
        const items = JSON.parse(await gunzipToText(base64ToBytes(b64))) as Bookmark[];
        bookmarks.push(...items);
      }
      const grpB64 = grpKeys.map((k) => (grpData[k] as string | undefined) ?? '').join('');
      if (grpB64) {
        groups = JSON.parse(await gunzipToText(base64ToBytes(grpB64))) as Group[];
      }
    } catch (err) {
      console.error('decompress sync data failed', err);
    }
    return { bookmarks, groups: normalizeGroups(groups), settings };
  }

  if (meta.format === 2) {
    // v2：整体压缩分片
    const dataKeys = Array.from({ length: meta.dataChunks ?? 0 }, (_, i) => `${DATA_PREFIX}${i}`);
    const dataObj = dataKeys.length
      ? await chrome.storage.sync.get(dataKeys)
      : {} as Record<string, unknown>;
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
    return { bookmarks, groups: normalizeGroups(groups), settings };
  }

  // v1：明文分片（老版本数据）
  const bmKeys = Array.from({ length: meta.bmChunks ?? 0 }, (_, i) => `${BM_PREFIX}${i}`);
  const grKeys = Array.from({ length: meta.grChunks ?? 0 }, (_, i) => `${GR_PREFIX}${i}`);
  const [bmData, grData] = await Promise.all([
    bmKeys.length
      ? chrome.storage.sync.get(bmKeys)
      : Promise.resolve<Record<string, unknown>>({}),
    grKeys.length
      ? chrome.storage.sync.get(grKeys)
      : Promise.resolve<Record<string, unknown>>({}),
  ]);

  const bookmarks: Bookmark[] = bmKeys.flatMap(
    (key) => (bmData[key] as Bookmark[] | undefined) ?? [],
  );
  const rawGroups: Group[] = grKeys.flatMap(
    (key) => (grData[key] as Group[] | undefined) ?? [],
  );

  return { bookmarks, groups: normalizeGroups(rawGroups), settings };
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
 * 估算完整状态写入 storage.sync 所需的字节数（按 v3 实际分组压缩流程计算）。
 * 异步：与真实写入同一套流程，预检不产生误判。
 */
export async function estimateBytes(state: AppState): Promise<number> {
  const { bmChunks, grpChunks } = await buildV3Payload(state);
  const dataBytes =
    bmChunks.reduce((s, c) => s + c.length, 0) +
    grpChunks.reduce((s, c) => s + c.length, 0);
  return dataBytes + (bmChunks.length + grpChunks.length) * 10 + 150; // key 名与 meta/settings 开销
}

/**
 * 将完整应用状态写回 storage.sync（v3：分组压缩 + 增量写入）。
 * 与云端现有分片逐 key 比对，只写变化的分片；写后清理旧格式与多余分片。
 */
export async function saveState(state: AppState): Promise<number> {
  const now = Date.now();
  const settings: Settings = { ...state.settings, lastSyncedAt: now };

  const metaObj = await chrome.storage.sync.get(META_KEY);
  const oldMeta = metaObj[META_KEY] as Meta | undefined;

  const { bmChunks, grpChunks } = await buildV3Payload(state);

  const meta: Meta = {
    version: 3,
    format: 3,
    bmGroups: bmChunks.length,
    grpChunks: grpChunks.length,
    updatedAt: now,
    deviceId: oldMeta?.deviceId ?? crypto.randomUUID(),
  };

  /* ---- 增量写入：先取云端现有分片，只写变化的部分 ---- */
  const prevIsV3 = oldMeta?.format === 3;
  const existingKeys = [
    ...Array.from({ length: prevIsV3 ? oldMeta?.bmGroups ?? 0 : 0 }, (_, i) => `${BG_PREFIX}${i}`),
    ...Array.from({ length: prevIsV3 ? oldMeta?.grpChunks ?? 0 : 0 }, (_, i) => `${GRP_PREFIX}${i}`),
  ];
  const existing = existingKeys.length
    ? await chrome.storage.sync.get(existingKeys)
    : ({} as Record<string, unknown>);

  const payload: Record<string, unknown> = {
    [SETTINGS_KEY]: settings,
    [META_KEY]: meta,
  };
  bmChunks.forEach((c, i) => {
    const key = `${BG_PREFIX}${i}`;
    if (existing[key] !== c) payload[key] = c;
  });
  grpChunks.forEach((c, i) => {
    const key = `${GRP_PREFIX}${i}`;
    if (existing[key] !== c) payload[key] = c;
  });

  /* ---- 清理必须先于写入 ----
   * 旧格式（v1/v2）分片可能已占满配额：若先写新格式再清理，
   * 写入会因配额不足被整体拒绝，清理永远执行不到，形成「重试永远失败」的死锁。
   * 先删除旧格式分片释放配额，迁移才能成功。 */
  const staleKeys: string[] = [];
  for (let i = bmChunks.length; i < (prevIsV3 ? oldMeta?.bmGroups ?? 0 : 0); i += 1) {
    staleKeys.push(`${BG_PREFIX}${i}`);
  }
  for (let i = grpChunks.length; i < (prevIsV3 ? oldMeta?.grpChunks ?? 0 : 0); i += 1) {
    staleKeys.push(`${GRP_PREFIX}${i}`);
  }
  if (oldMeta && (oldMeta.format ?? 1) < 3) {
    // v2 整体压缩分片
    for (let i = 0; i < (oldMeta.dataChunks ?? 0); i += 1) staleKeys.push(`${DATA_PREFIX}${i}`);
    // v1 明文分片
    for (let i = 0; i < (oldMeta.bmChunks ?? 0); i += 1) staleKeys.push(`${BM_PREFIX}${i}`);
    for (let i = 0; i < (oldMeta.grChunks ?? 0); i += 1) staleKeys.push(`${GR_PREFIX}${i}`);
  }
  if (staleKeys.length) await chrome.storage.sync.remove(staleKeys);

  await chrome.storage.sync.set(payload);

  return now;
}

/** 查询当前同步存储占用字节数（用于配额提示） */
export async function getUsage(): Promise<{ bytes: number; quota: number }> {
  const bytes = await chrome.storage.sync.getBytesInUse(null);
  return { bytes, quota: SYNC_QUOTA };
}

/** 同步诊断信息：扩展 ID（跨设备必须一致）+ 云端分区概览 */
export interface SyncDiagnostic {
  extensionId: string;
  bytes: number;
  quota: number;
  /** v3 为书签分组数；v2 为压缩分片数；v1 为明文分片数 */
  bmChunks: number;
  grChunks: number;
  /** 存储格式版本：3 = 分组压缩 + 增量写入 */
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
    bmChunks: meta?.bmGroups ?? meta?.dataChunks ?? meta?.bmChunks ?? 0,
    grChunks: meta?.grpChunks ?? meta?.grChunks ?? 0,
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
