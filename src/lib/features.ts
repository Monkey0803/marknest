/**
 * 功能级纯函数集合：URL 清理、高级搜索 DSL、智能文件夹、自动打标签、数据洞察、PIN。
 * 这些函数不依赖 chrome API 或 React，方便单独推理与复用。
 */

import type { AutoTagRule, Bookmark, Group, SmartFolder } from '../types';
import { getHost, normalizeUrl } from './utils';

/* ------------------------------ 快捷键 ------------------------------ */

/** 可自定义的快捷键动作及默认值 */
export const SHORTCUT_ACTIONS: { id: string; label: string; default: string }[] = [
  { id: 'command', label: '快速切换面板', default: 'Mod+K' },
  { id: 'new', label: '新建书签', default: 'Mod+N' },
  { id: 'locate', label: '定位当前页面', default: 'Mod+Shift+L' },
  { id: 'search', label: '聚焦搜索', default: '/' },
  { id: 'undo', label: '撤销', default: 'Mod+Z' },
  { id: 'redo', label: '重做', default: 'Mod+Shift+Z' },
  { id: 'selectAll', label: '全选', default: 'Mod+A' },
  { id: 'select', label: '多选当前书签', default: 'X' },
];

/** 把键盘事件转成规范化的组合键描述，如 Mod+Shift+L（兼容 React 合成事件） */
export function keyComboFromEvent(e: {
  metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string;
}): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return '';
  parts.push(key);
  return parts.join('+');
}

/** 判断按键事件是否匹配组合键描述（大小写不敏感） */
export function matchesCombo(e: {
  metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string;
}, combo?: string): boolean {
  if (!combo) return false;
  return keyComboFromEvent(e).toLowerCase() === combo.toLowerCase();
}

/* ------------------------------ URL 清理 ------------------------------ */

/** 已知追踪参数白名单：只删这些，保留其它 query（文档锚点、视频时间戳等不被破坏） */
export const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid', 'twclid',
  'igshid', 'mibextid', 'mc_cid', 'mc_eid', '_ga', 'yclid', 's_kwcid',
  'spm', 'ref_src',
];

/** 清理 URL 中的追踪参数，保留路径、其它 query 与 hash。无效 URL 原样返回。 */
export function stripTrackingParams(input: string): string {
  const url = normalizeUrl(input);
  try {
    const u = new URL(url);
    if (!u.search) return url;
    const kept = new URLSearchParams();
    let removed = false;
    u.searchParams.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (TRACKING_PARAMS.includes(lower) || lower.startsWith('utm_')) {
        removed = true;
      } else {
        kept.append(key, value);
      }
    });
    // 没有命中任何追踪参数时原样返回，避免重编码导致 URL 无谓变化
    if (!removed) return url;
    const query = kept.toString();
    const rebuilt = `${u.origin}${u.pathname}${query ? `?${query}` : ''}${u.hash}`;
    return rebuilt;
  } catch {
    return url;
  }
}

/** URL 指纹：用于去重/匹配，忽略协议、www、尾斜杠、追踪参数与 hash（大小写归一） */
export function urlFingerprint(input: string): string {
  try {
    const u = new URL(stripTrackingParams(input));
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const query = [...u.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k.toLowerCase()}=${v}`)
      .join('&');
    return `${host}${path}${query ? `?${query}` : ''}`;
  } catch {
    return normalizeUrl(input).replace(/\/+$/, '').toLowerCase();
  }
}

/* ------------------------------ 高级搜索 DSL ------------------------------ */

export interface ParsedQuery {
  /** 普通关键词（可多个，全部命中） */
  terms: string[];
  tags: string[];
  domains: string[];
  groups: string[];
  /** 创建时间下界（含） */
  after?: number;
  /** 创建时间上界（不含） */
  before?: number;
  /** 仅未读（阅读清单） */
  unread: boolean;
  /** 仅已置顶 */
  pinned: boolean;
  /** 仅未打标签 */
  untagged: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 解析查询表达式。支持引号包裹含空格的值，如 `tag:"设计 系统"`。 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = {
    terms: [], tags: [], domains: [], groups: [], unread: false, pinned: false, untagged: false,
  };
  const tokens = raw.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const unquote = (s: string) => s.replace(/^"|"$/g, '');
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === 'unread' || lower === '未读') { out.unread = true; continue; }
    if (lower === 'pinned' || lower === '置顶') { out.pinned = true; continue; }
    if (lower === 'untagged' || lower === '未打标签') { out.untagged = true; continue; }
    const colon = token.indexOf(':');
    if (colon > 0) {
      const field = token.slice(0, colon).toLowerCase();
      const value = unquote(token.slice(colon + 1));
      if (!value) continue;
      if (field === 'tag' || field === '标签') { out.tags.push(value.toLowerCase()); continue; }
      if (field === 'domain' || field === '域名') { out.domains.push(value.toLowerCase()); continue; }
      if (field === 'group' || field === '分组') { out.groups.push(value.toLowerCase()); continue; }
      if ((field === 'before' || field === '之前') && DATE_RE.test(value)) {
        out.before = new Date(`${value}T00:00:00`).getTime();
        continue;
      }
      if ((field === 'after' || field === '之后') && DATE_RE.test(value)) {
        out.after = new Date(`${value}T00:00:00`).getTime();
        continue;
      }
    }
    out.terms.push(unquote(token).toLowerCase());
  }
  return out;
}

/** 查询是否含有 DSL 操作符（用于区分普通搜索与高级搜索） */
export function hasAdvancedSyntax(raw: string): boolean {
  return /(?:^|\s)(?:tag|domain|group|before|after|标签|域名|分组|之前|之后):/i.test(raw)
    || /(?:^|\s)(?:unread|pinned|untagged|未读|置顶|未打标签)(?:\s|$)/i.test(raw);
}

export interface MatchContext {
  /** 分组 id → 完整层级路径文本 */
  groupPathText: Map<string, string>;
}

/** 判断单个书签是否命中解析后的查询（各条件 AND，同类多值 OR） */
export function matchesQuery(bm: Bookmark, q: ParsedQuery, ctx: MatchContext): boolean {
  if (q.unread && !bm.readLater) return false;
  if (q.pinned && !bm.pinned) return false;
  if (q.untagged && bm.tags.length > 0) return false;
  if (q.after && bm.createdAt < q.after) return false;
  if (q.before && bm.createdAt >= q.before) return false;
  if (q.tags.length && !q.tags.every((t) => bm.tags.some((own) => own.toLowerCase() === t))) return false;
  const host = getHost(bm.url).toLowerCase();
  if (q.domains.length && !q.domains.every((d) => host === d || host.endsWith(`.${d}`))) return false;
  if (q.groups.length) {
    const path = bm.groupId ? ctx.groupPathText.get(bm.groupId) ?? '' : '';
    if (!q.groups.every((g) => path.toLowerCase().includes(g))) return false;
  }
  if (q.terms.length) {
    const hay = `${bm.title} ${bm.url} ${getHost(bm.url)} ${bm.description} ${bm.tags.join(' ')} ${
      bm.groupId ? ctx.groupPathText.get(bm.groupId) ?? '' : ''
    }`.toLowerCase();
    if (!q.terms.every((t) => hay.includes(t))) return false;
  }
  return true;
}

/** 智能文件夹匹配：把保存的 query 当作高级搜索执行 */
export function matchesSmartFolder(bm: Bookmark, folder: SmartFolder, ctx: MatchContext): boolean {
  return matchesQuery(bm, parseSearchQuery(folder.query), ctx);
}

/* ------------------------------ 自动打标签 ------------------------------ */

/** 单条规则是否命中书签 */
export function ruleMatches(rule: AutoTagRule, bm: Pick<Bookmark, 'url' | 'title'>): boolean {
  const pattern = rule.pattern.trim().toLowerCase();
  if (!pattern) return false;
  if (rule.kind === 'domain') {
    const host = getHost(bm.url).toLowerCase();
    return host === pattern || host.endsWith(`.${pattern}`);
  }
  const hay = `${bm.title} ${bm.url}`.toLowerCase();
  return hay.includes(pattern);
}

/** 按规则集计算某书签应自动追加的标签（已存在的标签不会重复） */
export function autoTagsFor(rules: AutoTagRule[], bm: Pick<Bookmark, 'tags' | 'url' | 'title'>): string[] {
  const existing = new Set(bm.tags.map((t) => t.toLowerCase()));
  const add: string[] = [];
  for (const rule of rules) {
    if (!ruleMatches(rule, bm)) continue;
    for (const tag of rule.tags) {
      const t = tag.trim();
      if (t && !existing.has(t.toLowerCase()) && !add.some((x) => x.toLowerCase() === t.toLowerCase())) {
        add.push(t);
        existing.add(t.toLowerCase());
      }
    }
  }
  return add;
}

/* ------------------------------ 智能去重 ------------------------------ */

/** 重复组中的一条成员及其「适合保留」评分依据 */
export interface DuplicateMember {
  bookmark: Bookmark;
  /** 信息完整度评分，越高越适合作为保留项 */
  score: number;
  /** 得分理由，供界面展示（如「有备注」「3 个标签」） */
  reasons: string[];
}

/** 一组 URL 指纹相同、可合并的书签 */
export interface DuplicateGroup {
  /** 稳定标识：URL 指纹 */
  key: string;
  /** 推荐展示的代表网址（评分最高成员的原始网址） */
  url: string;
  host: string;
  /** 按评分降序排列，首项即推荐保留项 */
  members: DuplicateMember[];
  recommendedId: string;
  /** 可清理的冗余条数 = 成员数 - 1 */
  removableCount: number;
}

/**
 * 评估一条书签作为「保留项」的信息完整度。
 * 评分维度：备注 > 标签 > 访问 > 分组 > 置顶 > 阅读清单 > 图标 > 来源；
 * 同等分数下创建更早者胜出，避免结果随数组顺序漂移。
 */
export function scoreBookmarkForKeep(bm: Bookmark): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (bm.description?.trim()) { score += 4; reasons.push('有备注'); }
  const tagCount = bm.tags.filter((t) => t.trim()).length;
  if (tagCount) { score += Math.min(tagCount, 3) * 2; reasons.push(`${tagCount} 个标签`); }
  if (bm.visits > 0) { score += Math.min(bm.visits, 10); reasons.push(`访问 ${bm.visits} 次`); }
  if (bm.groupId) { score += 3; reasons.push('已分组'); }
  if (bm.pinned) { score += 2; reasons.push('已置顶'); }
  if (bm.readLater) { score += 1; reasons.push('在阅读清单'); }
  if (bm.favicon) { score += 1; reasons.push('有站点图标'); }
  if (bm.browserId) { score += 1; reasons.push('来自浏览器同步'); }
  if (bm.createdAt > 0) { score += 1; reasons.push('创建较早'); }
  return { score, reasons };
}

/**
 * 按 URL 指纹把书签归为重复组。
 * 指纹忽略协议、www、尾斜杠、追踪参数、hash 与 query 顺序，
 * 因此 `?utm_source=x`、`http://www.x.com/a/` 与干净网址会被识别为同一条。
 * 回收站与浏览器内部协议不参与处理。
 */
export function findDuplicateGroups(items: Bookmark[]): DuplicateGroup[] {
  const active = items.filter((b) => !b.deletedAt && /^https?:\/\//i.test(b.url));
  const buckets = new Map<string, Bookmark[]>();
  for (const bm of active) {
    const key = urlFingerprint(bm.url);
    if (!key) continue;
    const arr = buckets.get(key) ?? [];
    arr.push(bm);
    buckets.set(key, arr);
  }
  const out: DuplicateGroup[] = [];
  for (const [key, arr] of buckets) {
    if (arr.length < 2) continue;
    const members = arr.map((bookmark) => {
      const { score, reasons } = scoreBookmarkForKeep(bookmark);
      return { bookmark, score, reasons };
    }).sort((a, b) => b.score - a.score
      || a.bookmark.createdAt - b.bookmark.createdAt
      || a.bookmark.id.localeCompare(b.bookmark.id));
    out.push({
      key,
      url: members[0].bookmark.url,
      host: getHost(members[0].bookmark.url),
      members,
      recommendedId: members[0].bookmark.id,
      removableCount: arr.length - 1,
    });
  }
  return out.sort((a, b) => b.removableCount - a.removableCount
    || b.members.length - a.members.length
    || a.host.localeCompare(b.host));
}

/**
 * 计算把被移除书签合并进保留项后的元数据补丁。
 * 标签取并集（规范化去重，写法保留首次出现者）；备注取保留项，空缺时取最长的非空备注；
 * 访问数/最近访问取最大值；置顶与阅读清单按「任一为真则真」合并。
 */
export function mergedKeepPatch(keep: Bookmark, removed: Bookmark[]): Partial<Bookmark> {
  const tagMap = new Map<string, string>();
  for (const bm of [keep, ...removed]) {
    for (const tag of bm.tags) {
      const k = tag.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
      if (k && !tagMap.has(k)) tagMap.set(k, tag);
    }
  }
  let description = keep.description ?? '';
  if (!description.trim()) {
    description = removed
      .map((b) => b.description ?? '')
      .filter((d) => d.trim())
      .sort((a, b) => b.length - a.length)[0] ?? '';
  }
  return {
    tags: [...tagMap.values()],
    description,
    visits: Math.max(keep.visits, ...removed.map((b) => b.visits)),
    visitedAt: Math.max(keep.visitedAt, ...removed.map((b) => b.visitedAt)),
    pinned: keep.pinned || removed.some((b) => b.pinned),
    readLater: Boolean(keep.readLater || removed.some((b) => b.readLater)),
    updatedAt: Date.now(),
  };
}

/* ------------------------------ 数据洞察 ------------------------------ */

export interface DomainStat { domain: string; count: number; visits: number; }
export interface TagStat { tag: string; count: number; }
export interface TrendStat { month: string; count: number; }
export interface InsightData {
  total: number;
  grouped: number;
  tagged: number;
  totalVisits: number;
  domains: DomainStat[];
  tags: TagStat[];
  trends: TrendStat[];
  topVisited: Bookmark[];
}

/** 计算数据洞察：域名/标签分布、按月收藏趋势、最常访问 Top 10 */
export function computeInsights(bookmarks: Bookmark[]): InsightData {
  const active = bookmarks.filter((b) => !b.deletedAt);
  const domains = new Map<string, DomainStat>();
  const tags = new Map<string, TagStat>();
  const months = new Map<string, number>();
  for (const bm of active) {
    const host = getHost(bm.url) || '其它';
    const d = domains.get(host) ?? { domain: host, count: 0, visits: 0 };
    d.count += 1;
    d.visits += bm.visits;
    domains.set(host, d);
    for (const tag of bm.tags) {
      const t = tags.get(tag) ?? { tag, count: 0 };
      t.count += 1;
      tags.set(tag, t);
    }
    const month = new Date(bm.createdAt).toISOString().slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + 1);
  }
  return {
    total: active.length,
    grouped: active.filter((b) => b.groupId).length,
    tagged: active.filter((b) => b.tags.length > 0).length,
    totalVisits: active.reduce((s, b) => s + b.visits, 0),
    domains: [...domains.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    tags: [...tags.values()].sort((a, b) => b.count - a.count).slice(0, 12),
    trends: [...months.entries()]
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12),
    topVisited: [...active].filter((b) => b.visits > 0).sort((a, b) => b.visits - a.visits).slice(0, 10),
  };
}

/* ------------------------------ PIN ------------------------------ */

/** 轻量 PIN 哈希（仅防误看，不是安全级别加密）。加固定盐避免明文可直接识别。 */
export function hashPin(pin: string): string {
  const salted = `marknest::${pin}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < salted.length; i += 1) {
    const c = salted.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

export function verifyPin(pin: string, hash?: string): boolean {
  return Boolean(hash) && hashPin(pin) === hash;
}

/* ------------------------------ 分组工具 ------------------------------ */

/** 判断某分组是否受 PIN 保护（自身或任一祖先为私密分组） */
export function isPrivateGroup(groupId: string, groups: Group[]): boolean {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const seen = new Set<string>();
  let cur = byId.get(groupId);
  while (cur && !seen.has(cur.id)) {
    if (cur.private) return true;
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

/** 受保护分组 id 集合 */
export function privateGroupIds(groups: Group[]): Set<string> {
  const out = new Set<string>();
  for (const g of groups) if (isPrivateGroup(g.id, groups)) out.add(g.id);
  return out;
}
