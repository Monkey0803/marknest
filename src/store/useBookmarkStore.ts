import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppState,
  Bookmark,
  Group,
  Settings,
  SortMode,
  SyncStatus,
  ThemeMode,
  ViewMode,
} from '../types';
import {
  defaultState,
  loadState,
  normalizeGroups,
  onExternalChange,
  saveState,
} from '../lib/storage';
import { uid } from '../lib/utils';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export interface NewBookmarkInput {
  title: string;
  url: string;
  description?: string;
  groupId?: string | null;
  tags?: string[];
  /** 网站图标地址（来自浏览器标签页 favIconUrl），为空时由展示层从域名推导 */
  favicon?: string;
}

export interface NewGroupInput {
  name: string;
  color?: string;
  /** 父分组 id；不传或 null 表示顶层分组 */
  parentId?: string | null;
}

export function useBookmarkStore() {
  const [state, setState] = useState<AppState>(defaultState);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<SyncStatus>({
    phase: 'syncing',
    message: '正在载入云端数据',
    lastSyncedAt: 0,
  });
  const skipNextExternal = useRef(false);
  /** 同步镜像最新状态，供 moveGroup 之类需要「读当前值再判断」的操作使用 */
  const stateRef = useRef(state);
  stateRef.current = state;

  // 初始加载
  useEffect(() => {
    let alive = true;
    loadState()
      .then((loaded) => {
        if (!alive) return;
        setState(loaded);
        setReady(true);
        setSync({
          phase: 'synced',
          message: '已与 Google 账户同步',
          lastSyncedAt: loaded.settings.lastSyncedAt,
        });
      })
      .catch((err) => {
        if (!alive) return;
        console.error('loadState failed', err);
        setReady(true);
        setSync({ phase: 'error', message: '无法读取同步存储', lastSyncedAt: 0 });
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 本地未落盘时被其他设备覆盖，保留一份快照供用户恢复 */
  const [conflictBackup, setConflictBackup] = useState<AppState | null>(null);

  // 持久化：深度比较不需要，采用防抖；写入期间标记 syncing
  const persist = useCallback((next: AppState) => {
    setSync((s) => ({ ...s, phase: 'syncing', message: '正在同步到 Google 账户' }));
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        skipNextExternal.current = true;
        const now = await saveState(next);
        setSync({
          phase: 'synced',
          message: '已与 Google 账户同步',
          lastSyncedAt: now,
        });
      } catch (err) {
        console.error('saveState failed', err);
        setSync({
          phase: 'error',
          message: '同步失败：请检查网络或账户空间',
          lastSyncedAt: next.settings.lastSyncedAt,
        });
      } finally {
        saveTimer = null;
      }
    }, 180);
  }, []);

  // 统一的状态更新入口：更新内存态并触发持久化
  const commit = useCallback(
    (updater: (prev: AppState) => AppState) => {
      setState((prev) => {
        const next = updater(prev);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  // 监听外部（其他设备/标签页）变更，重新载入
  useEffect(() => {
    return onExternalChange(() => {
      if (skipNextExternal.current) {
        skipNextExternal.current = false;
        return;
      }
      // 本地还有未落盘的改动却先收到了远端更新：留快照，避免用户改动被静默覆盖
      const hadPendingLocalWrite = saveTimer !== null;
      const localSnapshot = stateRef.current;
      setSync((s) => ({ ...s, phase: 'syncing', message: '检测到其他设备的更新' }));
      loadState()
        .then((loaded) => {
          setState(loaded);
          if (hadPendingLocalWrite) setConflictBackup(localSnapshot);
          setSync({
            phase: 'synced',
            message: hadPendingLocalWrite
              ? '已载入云端版本（你的未保存改动已备份）'
              : '已从 Google 账户拉取最新数据',
            lastSyncedAt: loaded.settings.lastSyncedAt,
          });
        })
        .catch(() =>
          setSync({ phase: 'error', message: '拉取云端数据失败', lastSyncedAt: 0 }),
        );
    });
  }, []);

  /* ------------------------- 书签操作 ------------------------- */
  const addBookmark = useCallback(
    (input: NewBookmarkInput) => {
      const now = Date.now();
      const bm: Bookmark = {
        id: uid(),
        title: input.title.trim() || input.url,
        url: input.url.trim(),
        description: input.description?.trim() ?? '',
        groupId: input.groupId ?? null,
        tags: input.tags ?? [],
        favicon: input.favicon ?? '',
        createdAt: now,
        updatedAt: now,
        visitedAt: 0,
        visits: 0,
        pinned: false,
        order: now,
      };
      commit((prev) => ({ ...prev, bookmarks: [bm, ...prev.bookmarks] }));
      return bm;
    },
    [commit],
  );

  /** 批量添加书签（单次写入，用于从打开的标签页一键导入） */
  const addBookmarks = useCallback(
    (inputs: NewBookmarkInput[]) => {
      const now = Date.now();
      const items: Bookmark[] = inputs.map((input, i) => ({
        id: uid(),
        title: input.title.trim() || input.url,
        url: input.url.trim(),
        description: input.description?.trim() ?? '',
        groupId: input.groupId ?? null,
        tags: input.tags ?? [],
        favicon: input.favicon ?? '',
        createdAt: now + i,
        updatedAt: now + i,
        visitedAt: 0,
        visits: 0,
        pinned: false,
        order: now + i,
      }));
      if (items.length) {
        commit((prev) => ({ ...prev, bookmarks: [...items, ...prev.bookmarks] }));
      }
      return items.length;
    },
    [commit],
  );

  const updateBookmark = useCallback(
    (id: string, patch: Partial<Bookmark>) => {
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          b.id === id ? { ...b, ...patch, updatedAt: Date.now() } : b,
        ),
      }));
    },
    [commit],
  );

  const deleteBookmark = useCallback(
    (id: string) => {
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.filter((b) => b.id !== id),
      }));
    },
    [commit],
  );

  /* ------------------------- 批量操作 ------------------------- */
  /** 批量删除（配合撤销：调用方先留存快照即可） */
  const deleteBookmarks = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      commit((prev) => ({ ...prev, bookmarks: prev.bookmarks.filter((b) => !set.has(b.id)) }));
    },
    [commit],
  );

  /** 批量改分组：只改归属，保持顺序 */
  const moveBookmarksToGroup = useCallback(
    (ids: string[], groupId: string | null) => {
      const set = new Set(ids);
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          set.has(b.id) ? { ...b, groupId, updatedAt: Date.now() } : b,
        ),
      }));
    },
    [commit],
  );

  /** 批量追加标签（自动去重） */
  const addTagToBookmarks = useCallback(
    (ids: string[], tag: string) => {
      const t = tag.trim();
      if (!t) return;
      const set = new Set(ids);
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          set.has(b.id) && !b.tags.includes(t)
            ? { ...b, tags: [...b.tags, t], updatedAt: Date.now() }
            : b,
        ),
      }));
    },
    [commit],
  );

  /** 重命名标签；若目标标签已存在则等价于合并 */
  const renameTag = useCallback(
    (from: string, to: string) => {
      const name = to.trim();
      if (!name || name === from) return;
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) => {
          if (!b.tags.includes(from)) return b;
          const tags = Array.from(new Set(b.tags.map((t) => (t === from ? name : t))));
          return { ...b, tags, updatedAt: Date.now() };
        }),
      }));
    },
    [commit],
  );

  const deleteTag = useCallback(
    (tag: string) => {
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          b.tags.includes(tag)
            ? { ...b, tags: b.tags.filter((t) => t !== tag), updatedAt: Date.now() }
            : b,
        ),
      }));
    },
    [commit],
  );

  const togglePin = useCallback(
    (id: string) => {
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          b.id === id ? { ...b, pinned: !b.pinned, updatedAt: Date.now() } : b,
        ),
      }));
    },
    [commit],
  );

  const visitBookmark = useCallback(
    (id: string, url: string) => {
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          b.id === id
            ? {
                ...b,
                visits: b.visits + 1,
                visitedAt: Date.now(),
                // 打开阅读清单里的书签即视为已读，自动移出清单
                ...(b.readLater ? { readLater: false, readAt: Date.now() } : {}),
              }
            : b,
        ),
      }));
      chrome.tabs.create({ url });
    },
    [commit],
  );

  /** 加入 / 移出阅读清单（移出时记录已读时间） */
  const setReadLater = useCallback(
    (id: string, flag: boolean) => {
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          b.id === id
            ? { ...b, readLater: flag, readAt: flag ? undefined : Date.now(), updatedAt: Date.now() }
            : b,
        ),
      }));
    },
    [commit],
  );

  /** 拖拽重排：把 fromId 移动到 targetId 之前（或分组） */
  const moveBookmark = useCallback(
    (fromId: string, targetId: string | null, groupId: string | null) => {
      commit((prev) => {
        const from = prev.bookmarks.find((b) => b.id === fromId);
        if (!from) return prev;
        const others = prev.bookmarks.filter((b) => b.id !== fromId);
        let insertAt = others.length;
        if (targetId) {
          const idx = others.findIndex((b) => b.id === targetId);
          if (idx >= 0) insertAt = idx;
        }
        const moved: Bookmark = { ...from, groupId, updatedAt: Date.now() };
        const next = [...others];
        next.splice(insertAt, 0, moved);
        // 重算 order，保证手动排序稳定
        const reindexed = next.map((b, i) => ({ ...b, order: i }));
        return { ...prev, bookmarks: reindexed };
      });
    },
    [commit],
  );

  /* --------------------------- 分组操作 --------------------------- */
  const addGroup = useCallback(
    (input: NewGroupInput) => {
      const now = Date.now();
      const group: Group = {
        id: uid(),
        name: input.name.trim() || '新建分组',
        color: input.color ?? '#6a9bcc',
        createdAt: now,
        order: now,
        parentId: input.parentId ?? null,
      };
      commit((prev) => ({ ...prev, groups: [...prev.groups, group] }));
      return group;
    },
    [commit],
  );

  const updateGroup = useCallback(
    (id: string, patch: Partial<Group>) => {
      commit((prev) => ({
        ...prev,
        groups: prev.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
      }));
    },
    [commit],
  );

  /**
   * 整组移动：把分组挂到另一个分组下（parentId 为 null 表示移到顶层）。
   * 会拒绝「移动到自己」和「移动到自己的子分组」这两种会形成环的操作。
   * 返回是否真正执行，便于调用方给出提示。
   */
  const moveGroup = useCallback(
    (id: string, parentId: string | null): boolean => {
      const groups = stateRef.current.groups;
      const self = groups.find((g) => g.id === id);
      if (!self) return false;
      if (parentId === id) return false;
      if (parentId) {
        if (!groups.some((g) => g.id === parentId)) return false;
        // 目标在任何后代里都会成环
        const isDescendant = (() => {
          const seen = new Set<string>();
          let cur = groups.find((g) => g.id === parentId);
          while (cur && !seen.has(cur.id)) {
            if (cur.id === id) return true;
            seen.add(cur.id);
            cur = cur.parentId ? groups.find((g) => g.id === cur!.parentId) : undefined;
          }
          return false;
        })();
        if (isDescendant) return false;
      }
      if (self.parentId === parentId) return true;
      commit((prev) => {
        const siblings = prev.groups.filter((g) => g.parentId === parentId && g.id !== id);
        const nextOrder = siblings.reduce((max, g) => Math.max(max, g.order), 0) + 1;
        return {
          ...prev,
          groups: prev.groups.map((g) =>
            g.id === id ? { ...g, parentId, order: nextOrder } : g,
          ),
        };
      });
      return true;
    },
    [commit],
  );

  const deleteGroup = useCallback(
    (id: string) => {
      commit((prev) => {
        const target = prev.groups.find((g) => g.id === id);
        const fallbackParent = target?.parentId ?? null;
        return {
          ...prev,
          groups: prev.groups
            .filter((g) => g.id !== id)
            // 子分组上提一层，避免删父级时把整棵子树一起弄丢
            .map((g) => (g.parentId === id ? { ...g, parentId: fallbackParent } : g)),
          // 组内书签上提到父分组（顶层分组则回到未分组），不删除数据
          bookmarks: prev.bookmarks.map((b) =>
            b.groupId === id
              ? { ...b, groupId: fallbackParent, updatedAt: Date.now() }
              : b,
          ),
        };
      });
    },
    [commit],
  );

  /* --------------------------- 设置操作 --------------------------- */
  const setSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      commit((prev) => ({ ...prev, settings: { ...prev.settings, [key]: value } }));
    },
    [commit],
  );

  const setTheme = useCallback(
    (theme: ThemeMode) => setSetting('theme', theme),
    [setSetting],
  );
  const setView = useCallback((view: ViewMode) => setSetting('view', view), [setSetting]);
  const setSort = useCallback((sort: SortMode) => setSetting('sort', sort), [setSetting]);

  /** 批量导入（覆盖当前数据，用于 JSON 导入） */
  const importData = useCallback(
    (data: AppState) => {
      // 外部 JSON 可能来自旧版本，分组层级需要修复后才能安全渲染
      commit(() => ({ ...data, groups: normalizeGroups(data.groups) }));
    },
    [commit],
  );

  return {
    state,
    ready,
    sync,
    conflictBackup,
    dismissConflict: () => setConflictBackup(null),
    restoreConflict: () => {
      const backup = conflictBackup;
      if (!backup) return;
      commit(() => backup);
      setConflictBackup(null);
    },
    addBookmark,
    addBookmarks,
    updateBookmark,
    deleteBookmark,
    deleteBookmarks,
    moveBookmarksToGroup,
    addTagToBookmarks,
    renameTag,
    deleteTag,
    togglePin,
    visitBookmark,
    setReadLater,
    moveBookmark,
    addGroup,
    updateGroup,
    deleteGroup,
    moveGroup,
    setTheme,
    setView,
    setSort,
    setSetting,
    importData,
    manifestVersion: chrome.runtime.getManifest().version,
  };
}

export type BookmarkStore = ReturnType<typeof useBookmarkStore>;
