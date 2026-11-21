/**
 * 浏览器书签增量同步（前端侧）
 * ---------------------------------------------------------------------------
 * service worker 在 public/background.js 里监听 chrome.bookmarks 的增删改事件，
 * 把变更写入 local 队列 mn:browser-events；这里负责消费队列并合并进应用状态。
 * 增量事件在 worker 端已做去重与限长，前端按 browserId 识别同源书签，避免重复。
 */

import type { AppState, Bookmark, Group } from '../types';
import { uid } from './utils';
import { stripTrackingParams } from './features';

export const BROWSER_EVENTS_KEY = 'mn:browser-events';

export type BrowserBmEvent =
  | { type: 'created'; nodeId: string; title: string; url: string; parentId: string | null; at: number }
  | { type: 'changed'; nodeId: string; title?: string; url?: string; at: number }
  | { type: 'removed'; nodeId: string; at: number }
  | { type: 'moved'; nodeId: string; parentId: string | null; at: number };

/** 读取队列 */
export async function readBrowserEvents(): Promise<BrowserBmEvent[]> {
  try {
    const obj = await chrome.storage.local.get(BROWSER_EVENTS_KEY);
    const list = obj[BROWSER_EVENTS_KEY] as BrowserBmEvent[] | undefined;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 清空队列（消费成功后调用；消费前先读取，避免并发写入丢失） */
export async function clearBrowserEvents(): Promise<void> {
  await chrome.storage.local.remove(BROWSER_EVENTS_KEY).catch(() => {});
}

export interface MergeResult {
  state: AppState;
  added: number;
  updated: number;
  removed: number;
}

/**
 * 把浏览器事件合并进应用状态。
 * - created：按 browserId 去重，父文件夹映射为分组（syncFolders 开启时）；
 * - changed：按 browserId 找到书签，更新标题/网址；
 * - moved：更新归属分组；
 * - removed：软删除进回收站（syncRemovals）或彻底移除。
 */
export function mergeBrowserEvents(state: AppState, events: BrowserBmEvent[]): MergeResult {
  if (!events.length) return { state, added: 0, updated: 0, removed: 0 };
  const settings = state.settings;
  const folderMap = { ...settings.browserSync.folderMap };
  const byBrowserId = new Map<string, Bookmark>();
  state.bookmarks.forEach((b) => { if (b.browserId) byBrowserId.set(b.browserId, b); });

  let bookmarks = [...state.bookmarks];
  let groups = [...state.groups];
  let added = 0;
  let updated = 0;
  let removed = 0;
  const now = Date.now();

  const groupForParent = (parentId: string | null): string | null => {
    if (!settings.browserSync.syncFolders || !parentId) return null;
    if (folderMap[parentId]) return folderMap[parentId];
    // 文件夹本身尚未建立映射：创建一个分组（名称稍后由文件夹 created 事件补上或保持默认）
    const g: Group = {
      id: uid(),
      name: '浏览器书签',
      color: '#8a8f98',
      createdAt: now,
      order: now + groups.length,
      parentId: null,
    };
    groups = [...groups, g];
    folderMap[parentId] = g.id;
    return g.id;
  };

  for (const ev of events) {
    if (ev.type === 'created') {
      if (byBrowserId.has(ev.nodeId)) continue;
      if (!/^https?:\/\//i.test(ev.url)) {
        // 文件夹：记录文件夹 id → 分组（供其子节点归属）
        if (settings.browserSync.syncFolders && !folderMap[ev.nodeId]) {
          const g: Group = {
            id: uid(), name: ev.title || '浏览器文件夹', color: '#8a8f98',
            createdAt: now, order: now + groups.length, parentId: groupForParent(ev.parentId),
          };
          groups = [...groups, g];
          folderMap[ev.nodeId] = g.id;
        }
        continue;
      }
      const gid = groupForParent(ev.parentId);
      const cleanUrl = settings.stripTracking ? stripTrackingParams(ev.url) : ev.url;
      const bm: Bookmark = {
        id: uid(), title: ev.title || ev.url, url: cleanUrl, description: '', groupId: gid,
        tags: [], favicon: '', createdAt: now, updatedAt: now, visitedAt: 0, visits: 0,
        pinned: false, order: now + added, browserId: ev.nodeId,
      };
      bookmarks = [bm, ...bookmarks];
      byBrowserId.set(ev.nodeId, bm);
      added += 1;
    } else if (ev.type === 'changed') {
      const bm = byBrowserId.get(ev.nodeId);
      if (!bm) continue;
      const cleanChangedUrl = ev.url && /^https?:\/\//i.test(ev.url)
        ? (settings.stripTracking ? stripTrackingParams(ev.url) : ev.url)
        : undefined;
      bookmarks = bookmarks.map((b) => b.id === bm.id
        ? {
            ...b,
            ...(ev.title !== undefined ? { title: ev.title } : {}),
            ...(cleanChangedUrl ? { url: cleanChangedUrl } : {}),
            updatedAt: now,
          }
        : b);
      updated += 1;
    } else if (ev.type === 'moved') {
      const bm = byBrowserId.get(ev.nodeId);
      if (!bm) continue;
      const gid = groupForParent(ev.parentId);
      bookmarks = bookmarks.map((b) => b.id === bm.id ? { ...b, groupId: gid, updatedAt: now } : b);
      updated += 1;
    } else if (ev.type === 'removed') {
      const bm = byBrowserId.get(ev.nodeId);
      if (!bm) {
        // 可能是文件夹被删：清掉映射，分组保留（数据不丢）
        delete folderMap[ev.nodeId];
        continue;
      }
      if (settings.browserSync.syncRemovals) {
        bookmarks = bookmarks.map((b) => b.id === bm.id
          ? { ...b, deletedAt: now, updatedAt: now }
          : b);
      } else {
        bookmarks = bookmarks.filter((b) => b.id !== bm.id);
      }
      byBrowserId.delete(ev.nodeId);
      removed += 1;
    }
  }

  return {
    state: {
      ...state,
      bookmarks,
      groups,
      settings: {
        ...settings,
        browserSync: { ...settings.browserSync, folderMap, lastSyncedAt: now },
      },
    },
    added, updated, removed,
  };
}
