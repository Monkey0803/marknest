import type { Bookmark, Group, SortMode } from '../types';

export function uid(): string {
  return crypto.randomUUID();
}

/** 侧栏数字角标：0 不显示，超过 99 显示「99+」，避免撑破角标布局 */
export function formatCount(n: number): string {
  if (!n || n <= 0) return '';
  return n > 99 ? '99+' : String(n);
}

/* ----------------------- 分组树（支持任意层级） ----------------------- */

export interface GroupNode {
  group: Group;
  /** 缩进层级，顶层为 0 */
  depth: number;
  children: GroupNode[];
}

/** 按手动顺序排列分组（order 相同则按创建时间） */
export function sortGroups(groups: Group[]): Group[] {
  return [...groups].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/**
 * 把扁平的分组数组构建成树。
 * 容错：parentId 指向不存在的分组、指向自身、或多层嵌套成环时，一律视为顶层，
 * 保证任何脏数据都不会导致渲染死循环或分组「消失」。
 */
export function buildGroupTree(groups: Group[]): GroupNode[] {
  const sorted = sortGroups(groups);
  const byId = new Map(sorted.map((g) => [g.id, g]));

  const safeParent = (g: Group): string | null => {
    const pid = g.parentId;
    if (!pid || pid === g.id || !byId.has(pid)) return null;
    // 沿祖先链向上，若回到自己则说明成环
    const seen = new Set<string>([g.id]);
    let cur: Group | undefined = byId.get(pid);
    while (cur) {
      if (seen.has(cur.id)) return null;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return pid;
  };

  const childrenOf = new Map<string | null, Group[]>();
  for (const g of sorted) {
    const pid = safeParent(g);
    const arr = childrenOf.get(pid);
    if (arr) arr.push(g);
    else childrenOf.set(pid, [g]);
  }

  const build = (pid: string | null, depth: number): GroupNode[] =>
    (childrenOf.get(pid) ?? []).map((group) => ({
      group,
      depth,
      children: build(group.id, depth + 1),
    }));

  return build(null, 0);
}

/** 深度优先平铺树，便于按层级顺序渲染列表 */
export function flattenGroupTree(nodes: GroupNode[]): GroupNode[] {
  const out: GroupNode[] = [];
  const walk = (list: GroupNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** 构建 parentId → 子分组 id 列表的索引（含脏数据容错：自引用/指向不存在的父一律当顶层） */
export function buildChildrenIndex(groups: Group[]): Map<string, string[]> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const childrenOf = new Map<string, string[]>();
  for (const g of groups) {
    const pid = g.parentId;
    if (!pid || pid === g.id || !byId.has(pid)) continue;
    const arr = childrenOf.get(pid);
    if (arr) arr.push(g.id);
    else childrenOf.set(pid, [g.id]);
  }
  return childrenOf;
}

/** 分组自身 + 全部后代分组的 id 集合 */
export function groupSubtreeIds(groups: Group[], rootId: string): Set<string> {
  return subtreeIdsFromIndex(buildChildrenIndex(groups), rootId);
}

/** 基于已建好的子索引求单个分组的子树，避免重复建图 */
export function subtreeIdsFromIndex(childrenOf: Map<string, string[]>, rootId: string): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    (childrenOf.get(id) ?? []).forEach(walk);
  };
  walk(rootId);
  return out;
}

/**
 * 一次性算出所有分组的「自身 + 后代」id 集合。
 * 对 G 个分组只建一次索引、每个分组只被并入祖先链，整体 O(G·depth)，
 * 替代对每组调用 groupSubtreeIds 造成的 O(G²) 建图开销。
 */
export function buildAllSubtrees(groups: Group[]): Map<string, Set<string>> {
  const childrenOf = buildChildrenIndex(groups);
  const result = new Map<string, Set<string>>();
  // 深度优先自底向上合并：先算子节点，再把自己加进去并继承子集合
  const seen = new Set<string>();
  const visit = (id: string): Set<string> => {
    if (result.has(id)) return result.get(id)!;
    if (seen.has(id)) return new Set([id]); // 环：只保留自己，避免无限递归
    seen.add(id);
    const set = new Set<string>([id]);
    for (const child of childrenOf.get(id) ?? []) {
      for (const cid of visit(child)) set.add(cid);
    }
    result.set(id, set);
    seen.delete(id);
    return set;
  };
  for (const g of groups) visit(g.id);
  return result;
}

/** 从顶层到当前分组的路径（用于面包屑） */
export function groupPath(groups: Group[], id: string): Group[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const path: Group[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** 从 URL 中解析出用于展示的域名 */
export function getHost(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url;
  }
}

/** 尝试补全 url 协议 */
export function normalizeUrl(input: string): string {
  const value = input.trim();
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

/**
 * favicon 命中缓存：记录每个域名「实际加载成功」的图标地址。
 * 下次优先用它，避免每次都从 favicon.ico 试到 Google 公共图标服务（每条书签 2 次请求）。
 */
const FAV_CACHE_KEY = 'mn:faviconCache';
let favCache: Record<string, string> = (() => {
  try {
    const raw = localStorage.getItem(FAV_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
})();

export function cachedFavicon(url: string): string {
  return favCache[getHost(url)] ?? '';
}

export function rememberFavicon(url: string, iconUrl: string): void {
  const host = getHost(url);
  if (!host || !iconUrl || favCache[host] === iconUrl) return;
  favCache = { ...favCache, [host]: iconUrl };
  try {
    localStorage.setItem(FAV_CACHE_KEY, JSON.stringify(favCache));
  } catch {
    // 存储配额不足时忽略，不影响功能
  }
}

/**
 * 生成 favicon 候选地址（按优先级）：
 * 1. 该域名上次加载成功的图标（缓存，命中即只发一次请求）
 * 2. 书签保存的图标地址（收藏标签页 / 右键收藏时写入）
 * 3. 站点根 favicon.ico
 * 4. Google 公共图标服务（可跨站兜底）
 * 组件依次尝试，全部失败才回退首字母占位。
 */
export function faviconCandidates(bm: Pick<Bookmark, 'url' | 'favicon'>): string[] {
  const out: string[] = [];
  const cached = cachedFavicon(bm.url);
  if (cached) out.push(cached);
  if (bm.favicon) out.push(bm.favicon);
  try {
    const u = new URL(bm.url.startsWith('http') ? bm.url : `https://${bm.url}`);
    const origin = u.origin;
    const host = u.hostname;
    out.push(`${origin}/favicon.ico`);
    out.push(`https://www.google.com/s2/favicons?domain=${host}&sz=64`);
  } catch {
    // URL 无法解析时仅保留已保存的图标
  }
  // 去重（保持顺序）
  return out.filter((v, i) => v && out.indexOf(v) === i);
}

/** 根据 URL 生成一个稳定的品牌色（用于默认 favicon 占位） */
export function colorFromString(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 52%)`;
}

/** URL 是否有效 */
export function isValidUrl(input: string): boolean {
  try {
    const u = new URL(normalizeUrl(input));
    return Boolean(u.hostname && u.hostname.includes('.'));
  } catch {
    return false;
  }
}

/* ----------------------- 搜索命中高亮 ----------------------- */

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/**
 * 把文本按查询词的命中位置切成片段（大小写不敏感，只取第一段连续命中，
 * 中文/英文关键词都能覆盖）。无命中时返回整段未命中，调用方可直接渲染原文。
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const q = query.trim().toLowerCase();
  if (!q || !text) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return [{ text, hit: false }];
  const segs: HighlightSegment[] = [];
  if (idx > 0) segs.push({ text: text.slice(0, idx), hit: false });
  segs.push({ text: text.slice(idx, idx + q.length), hit: true });
  const rest = text.slice(idx + q.length);
  if (rest) segs.push({ text: rest, hit: false });
  return segs;
}

export function relativeTime(ts: number): string {
  if (!ts) return '尚未同步';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return '刚刚';
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/** 排序书签 */
export function sortBookmarks(items: Bookmark[], mode: SortMode): Bookmark[] {
  const copy = [...items];
  switch (mode) {
    case 'recent':
      return copy.sort((a, b) => b.updatedAt - a.updatedAt);
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    case 'visits':
      return copy.sort((a, b) => b.visits - a.visits);
    case 'manual':
    default:
      return copy.sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order,
      );
  }
}

/** 找出 URL 完全相同的重复书签分组（返回重复项 id 列表） */
export function findDuplicates(items: Bookmark[]): string[] {
  const seen = new Map<string, Bookmark[]>();
  for (const bm of items) {
    const key = normalizeUrl(bm.url).replace(/\/+$/, '').toLowerCase();
    const arr = seen.get(key) ?? [];
    arr.push(bm);
    seen.set(key, arr);
  }
  const dupIds: string[] = [];
  for (const arr of seen.values()) {
    if (arr.length > 1) {
      // 保留最早创建的一条，其余标记为重复
      arr
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(1)
        .forEach((bm) => dupIds.push(bm.id));
    }
  }
  return dupIds;
}

/* ----------------------- 重复标签检测 ----------------------- */

export interface DuplicateTagGroup {
  /** 建议保留的规范标签（使用次数最多，其次名字最短） */
  canonical: string;
  /** 参与合并的成员（含规范标签自身），按使用次数降序 */
  members: { tag: string; count: number }[];
  /** 成员合计使用次数 */
  total: number;
}

/** 标签规范化：全半角归一、去空白、小写 —— 「Design / design / Design 」视为同一标签 */
function normalizeTagKey(tag: string): string {
  return tag.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** 找出语义重复的标签组（仅大小写/全半角/空白差异），供一键合并 */
export function findDuplicateTags(bookmarks: Bookmark[]): DuplicateTagGroup[] {
  // 统计每个标签的使用次数
  const counts = new Map<string, number>();
  for (const bm of bookmarks) {
    for (const t of bm.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  // 按规范化 key 归组
  const buckets = new Map<string, { tag: string; count: number }[]>();
  for (const [tag, count] of counts) {
    const key = normalizeTagKey(tag);
    const arr = buckets.get(key) ?? [];
    arr.push({ tag, count });
    buckets.set(key, arr);
  }
  // 组内成员 > 1 才算重复
  const out: DuplicateTagGroup[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort(
      (a, b) => b.count - a.count || a.tag.length - b.tag.length || a.tag.localeCompare(b.tag),
    );
    out.push({
      canonical: sorted[0].tag,
      members: sorted,
      total: sorted.reduce((s, m) => s + m.count, 0),
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

/** 导出为 Netscape Bookmark HTML（Chrome / Firefox / Safari 通用格式） */
export function exportToHtml(bookmarks: Bookmark[], groups: Group[]): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const stamp = Date.now() / 1000;
  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];

  const renderBm = (bm: Bookmark, indent: string) => {
    const tags = bm.tags.length ? ` TAGS="${esc(bm.tags.join(','))}"` : '';
    lines.push(
      `${indent}<DT><A HREF="${esc(bm.url)}" ADD_DATE="${Math.floor(bm.createdAt / 1000)}"${tags}>${esc(bm.title)}</A>`,
    );
  };

  // 未分组
  const ungrouped = bookmarks.filter((b) => !b.groupId);
  ungrouped.forEach((bm) => renderBm(bm, '    '));

  // 分组（按嵌套层级导出为多层文件夹，Chrome/Firefox 导入后会保留层级）
  const renderNodes = (nodes: GroupNode[], indent: string) => {
    for (const node of nodes) {
      const group = node.group;
      lines.push(
        `${indent}<DT><H3 ADD_DATE="${Math.floor(group.createdAt / 1000)}">${esc(group.name)}</H3>`,
      );
      lines.push(`${indent}<DL><p>`);
      bookmarks
        .filter((b) => b.groupId === group.id)
        .forEach((bm) => renderBm(bm, `${indent}    `));
      renderNodes(node.children, `${indent}    `);
      lines.push(`${indent}</DL><p>`);
    }
  };
  renderNodes(buildGroupTree(groups), '    ');
  lines.push('</DL><p>');
  void stamp;
  return lines.join('\n');
}

/** 导出某个分组（含子分组）为独立只读 HTML 分享页，可发给他人直接打开 */
export function exportGroupHtml(groupId: string, bookmarks: Bookmark[], groups: Group[]): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const subIds = groupSubtreeIds(groups, groupId);
  const group = groups.find((g) => g.id === groupId);
  const title = group?.name ?? '书签分享';
  const items = bookmarks.filter((b) => !b.deletedAt && b.groupId && subIds.has(b.groupId));
  const byGroup = new Map<string, Bookmark[]>();
  items.forEach((b) => {
    const arr = byGroup.get(b.groupId!) ?? [];
    arr.push(b);
    byGroup.set(b.groupId!, arr);
  });
  const section = (gid: string, depth: number): string => {
    const g = groups.find((x) => x.id === gid);
    if (!g) return '';
    const list = byGroup.get(gid) ?? [];
    const children = groups.filter((x) => x.parentId === gid);
    const links = list.map((b) =>
      `<li><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.title)}</a>${
        b.description ? `<p>${esc(b.description)}</p>` : ''
      }<small>${esc(getHost(b.url))}</small></li>`,
    ).join('');
    return `<section style="margin-left:${depth * 16}px"><h2 style="color:${esc(g.color)}">${esc(g.name)}</h2>${
      links ? `<ul>${links}</ul>` : '<p class="muted">（此分组暂无书签）</p>'
    }${children.map((c) => section(c.id, depth + 1)).join('')}</section>`;
  };
  const stamp = new Date().toLocaleString('zh-CN');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · 书签分享</title>
<style>
:root{color-scheme:light dark}body{font:15px/1.6 -apple-system,"Segoe UI",Roboto,"PingFang SC",sans-serif;max-width:860px;margin:0 auto;padding:32px 20px;color:#222;background:#fff}
@media(prefers-color-scheme:dark){body{color:#eee;background:#181a1f}a{color:#8ab4f8}}
h1{border-bottom:2px solid #888;padding-bottom:8px}h2{margin-top:28px;font-size:18px}ul{list-style:none;padding:0}
li{padding:10px 0;border-bottom:1px solid rgba(128,128,128,.2)}li a{font-weight:600;text-decoration:none}li a:hover{text-decoration:underline}
li p{margin:4px 0;color:#888;font-size:13px}li small{color:#999;font-size:12px}.muted{color:#999;font-style:italic}
header p{color:#888;font-size:13px}footer{margin-top:40px;color:#999;font-size:12px;text-align:center}
</style></head><body>
<header><h1>📚 ${esc(title)}</h1><p>由 Marknest 导出的只读书签分享页 · ${items.length} 个书签 · 生成于 ${stamp}</p></header>
${section(groupId, 0)}
<footer>Shared with Marknest</footer>
</body></html>`;
}

export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
