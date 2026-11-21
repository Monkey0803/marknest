import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  estimateBytes,
  loadState,
  normalizeGroups,
  onExternalChange,
  PENDING_ADD_KEY,
  saveArchivedBookmarks,
  saveState,
  SyncAbortedError,
  SYNC_QUOTA,
  type PendingAdd,
} from '../lib/storage';
import { uid } from '../lib/utils';
import { autoTagsFor, stripTrackingParams } from '../lib/features';
import {
  BROWSER_EVENTS_KEY,
  clearBrowserEvents,
  mergeBrowserEvents,
  readBrowserEvents,
} from '../lib/browserSync';

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 写入世代号：远端加载时递增，使在途的旧快照写入失效，避免覆盖刚拉取的云端数据 */
let writeGeneration = 0;

/**
 * 把 chrome.storage.sync 的写入错误翻译成用户能对症处理的提示：
 * Chrome 的报错文本（如 QUOTA_BYTES、MAX_WRITE_OPERATIONS、网络错误）差异较大，按关键词归类。
 */
function describeSyncError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/quota/i.test(msg)) {
    return '同步容量已达上限（100 KB）：先导出 JSON 备份，再清理部分书签后重试';
  }
  if (/MAX_WRITE_OPERATIONS|write operations/i.test(msg)) {
    return '同步写入过于频繁：稍等一两分钟再点「重试」即可';
  }
  if (/network|net::|connection|timed?\s?out|offline/i.test(msg)) {
    return '网络不可用：改动暂存在本地，恢复联网后点「重试」';
  }
  return '同步失败：请确认 Chrome 已登录 Google 账户并开启了同步';
}

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
  /** 最近一次自己成功写入的 updatedAt，用于识别「自己的写入」触发的 onChanged */
  const lastSelfWriteAt = useRef(0);
  /** 初始加载是否完成：完成前的 meta 写入（首次安装）不应触发远端拉取 */
  const readyRef = useRef(false);
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
        readyRef.current = true;
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
    // 捕获本次写入的世代号：若期间有远端数据到达并递增了世代，写入会被作废
    const gen = ++writeGeneration;
    saveTimer = setTimeout(async () => {
      try {
        // shouldAbort 让 saveState 在每次真正写盘前再确认一次世代仍有效；
        // onCommit 在写 meta 前回传时间戳，提前标记为自己的写入，避免自触发重载
        const now = await saveState(
          next,
          () => gen !== writeGeneration,
          (at) => { if (gen === writeGeneration) lastSelfWriteAt.current = at; },
        );
        if (gen !== writeGeneration) return; // 期间被远端加载作废：不更新 UI，也不覆盖状态
        lastSelfWriteAt.current = Math.max(lastSelfWriteAt.current, now);
        setSync({
          phase: 'synced',
          message: '已与 Google 账户同步',
          lastSyncedAt: now,
        });
      } catch (err) {
        if (err instanceof SyncAbortedError || gen !== writeGeneration) return;
        console.error('saveState failed', err);
        setSync({
          phase: 'error',
          message: describeSyncError(err),
          lastSyncedAt: next.settings.lastSyncedAt,
        });
      } finally {
        if (gen === writeGeneration) saveTimer = null;
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

  /** 右键菜单入队的书签由这里消费：引用在 addBookmark 定义后回填 */
  const drainPendingRef = useRef<() => void>(() => {});

  // 监听外部（其他设备/标签页）变更，重新载入
  useEffect(() => {
    let remoteLoading = false;
    return onExternalChange((remoteAt, pendingAdd) => {
      if (!readyRef.current) return;
      // 右键收藏队列：单独消费，不走远端重载（meta 未变）
      if (pendingAdd) drainPendingRef.current();
      if (remoteAt <= 0) return;
      if (remoteLoading) return;
      // 云端更新不比自己最近写入的时间新 → 是自己的写入触发的回调，忽略
      const localAt = Math.max(lastSelfWriteAt.current, stateRef.current.settings.lastSyncedAt ?? 0);
      if (remoteAt <= localAt) return;

      // 本地还有未落盘的改动却先收到了远端更新：留快照，避免用户改动被静默覆盖
      const hadPendingLocalWrite = saveTimer !== null;
      const localSnapshot = stateRef.current;
      // 关键：取消待写定时器 + 递增世代，让在途/待写的本地快照不再覆盖刚拉取的远端数据
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      writeGeneration += 1;
      remoteLoading = true;
      setSync((s) => ({ ...s, phase: 'syncing', message: '检测到其他设备的更新' }));
      loadState()
        .then((loaded) => {
          setState(loaded);
          lastSelfWriteAt.current = loaded.settings.lastSyncedAt ?? remoteAt;
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
        )
        .finally(() => {
          remoteLoading = false;
        });
    });
  }, []);

  // 浏览器书签事件写入 local：单独监听并消费（service worker 端产生）
  useEffect(() => {
    const handler = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === 'local' && changes[BROWSER_EVENTS_KEY]?.newValue) {
        drainBrowserRef.current();
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, []);

  /* ------------------------- 书签操作 ------------------------- */
  /** 容量预检：写入后的总字节数是否超过 chrome.storage.sync 的 100KB 配额（按 v2 压缩流程估算） */
  const quotaDeny = useCallback((message: string) => {
    setSync({
      phase: 'error',
      message,
      lastSyncedAt: stateRef.current.settings.lastSyncedAt,
    });
  }, []);

  const addBookmark = useCallback(
    async (input: NewBookmarkInput): Promise<Bookmark | null> => {
      const now = Date.now();
      const settings = stateRef.current.settings;
      const cleanUrl = settings.stripTracking ? stripTrackingParams(input.url.trim()) : input.url.trim();
      const tags = [...(input.tags ?? [])];
      // 自动打标签：按域名/关键词规则追加
      const draft = { tags } as Bookmark;
      const auto = autoTagsFor(settings.autoTagRules, { ...draft, url: cleanUrl, title: input.title });
      auto.forEach((t) => { if (!tags.includes(t)) tags.push(t); });
      const bm: Bookmark = {
        id: uid(),
        title: input.title.trim() || cleanUrl,
        url: cleanUrl,
        description: input.description?.trim() ?? '',
        groupId: input.groupId ?? null,
        tags,
        favicon: input.favicon ?? '',
        createdAt: now,
        updatedAt: now,
        visitedAt: 0,
        visits: 0,
        pinned: false,
        order: now,
      };
      // 容量预检：超限时拒绝写入，避免整次同步失败
      const bytes = await estimateBytes({
        ...stateRef.current,
        bookmarks: [bm, ...stateRef.current.bookmarks],
      });
      if (bytes > SYNC_QUOTA) {
        quotaDeny(`同步空间不足：该书签写入后超出 100 KB 上限，请清理或备份书签`);
        return null;
      }
      commit((prev) => ({ ...prev, bookmarks: [bm, ...prev.bookmarks] }));
      return bm;
    },
    [commit, quotaDeny],
  );

  /** 消费右键菜单收藏队列：逐条走 addBookmark（自带 URL 去重 / 容量预检 / v3 持久化） */
  const drainPending = useCallback(async () => {
    let items: PendingAdd[] = [];
    try {
      const obj = await chrome.storage.sync.get(PENDING_ADD_KEY);
      items = (obj[PENDING_ADD_KEY] as PendingAdd[] | undefined) ?? [];
    } catch {
      return;
    }
    if (!items.length) return;
    // 先清空再写：即便中途失败也不会重复消费同一批
    await chrome.storage.sync.remove(PENDING_ADD_KEY).catch(() => {});
    for (const item of items) {
      if (!/^https?:\/\//i.test(item.url)) continue;
      await addBookmark({
        title: item.title || item.url,
        url: item.url,
        favicon: item.favicon ?? '',
      });
    }
  }, [addBookmark]);
  drainPendingRef.current = () => { void drainPending(); };

  // 初始加载完成后也消费一次：扩展未打开时积攒的右键收藏
  useEffect(() => {
    if (ready) drainPendingRef.current();
  }, [ready]);

  /** 批量添加书签（单次写入，用于从打开的标签页一键导入）。
   *  返回：新增条数；-1 表示超出同步容量，本次未写入。 */
  const addBookmarks = useCallback(
    async (inputs: NewBookmarkInput[]): Promise<number> => {
      const now = Date.now();
      const settings = stateRef.current.settings;
      const items: Bookmark[] = inputs.map((input, i) => {
        const cleanUrl = settings.stripTracking ? stripTrackingParams(input.url.trim()) : input.url.trim();
        const tags = [...(input.tags ?? [])];
        const auto = autoTagsFor(settings.autoTagRules, { tags, url: cleanUrl, title: input.title } as Bookmark);
        auto.forEach((t) => { if (!tags.includes(t)) tags.push(t); });
        return {
          id: uid(),
          title: input.title.trim() || cleanUrl,
          url: cleanUrl,
          description: input.description?.trim() ?? '',
          groupId: input.groupId ?? null,
          tags,
          favicon: input.favicon ?? '',
          createdAt: now + i,
          updatedAt: now + i,
          visitedAt: 0,
          visits: 0,
          pinned: false,
          order: now + i,
        };
      });
      if (items.length) {
        // 容量预检：超限时整体拒绝，避免「内存里加了、云端写失败」的静默丢数据
        const bytes = await estimateBytes({
          ...stateRef.current,
          bookmarks: [...items, ...stateRef.current.bookmarks],
        });
        if (bytes > SYNC_QUOTA) {
          quotaDeny('同步空间不足：本次批量收藏会超出 100 KB 上限，请先导出备份并清理书签');
          return -1;
        }
        commit((prev) => ({ ...prev, bookmarks: [...items, ...prev.bookmarks] }));
      }
      return items.length;
    },
    [commit, quotaDeny],
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

  /** 软删除：进入回收站，7 天后由用户手动清空；撤销仍可完整恢复 */
  const deleteBookmark = useCallback(
    (id: string) => {
      const now = Date.now();
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          b.id === id ? { ...b, deletedAt: b.deletedAt ?? now, updatedAt: now } : b,
        ),
      }));
    },
    [commit],
  );

  /* ------------------------- 批量操作 ------------------------- */
  /** 批量软删除（进入回收站） */
  const deleteBookmarks = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      const now = Date.now();
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          set.has(b.id) ? { ...b, deletedAt: b.deletedAt ?? now, updatedAt: now } : b,
        ),
      }));
    },
    [commit],
  );

  /* ------------------------- 回收站 ------------------------- */
  /** 还原回收站中的书签 */
  const restoreBookmarks = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) => {
          if (!set.has(b.id) || !b.deletedAt) return b;
          const next = { ...b, updatedAt: Date.now() };
          delete next.deletedAt;
          return next;
        }),
      }));
    },
    [commit],
  );

  /** 彻底删除（不可恢复，用于回收站的「永久删除」） */
  const purgeBookmarks = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      commit((prev) => ({ ...prev, bookmarks: prev.bookmarks.filter((b) => !set.has(b.id)) }));
    },
    [commit],
  );

  /** 清空回收站 */
  const emptyTrash = useCallback(() => {
    commit((prev) => ({ ...prev, bookmarks: prev.bookmarks.filter((b) => !b.deletedAt) }));
  }, [commit]);

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

  /** 批量改备注 */
  const bulkSetDescription = useCallback(
    (ids: string[], description: string) => {
      const set = new Set(ids);
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          set.has(b.id) ? { ...b, description: description.trim(), updatedAt: Date.now() } : b,
        ),
      }));
    },
    [commit],
  );

  /** 批量替换网址前缀（如把 http:// 换成 https://，或迁移域名） */
  const bulkReplaceUrl = useCallback(
    (ids: string[], from: string, to: string) => {
      const needle = from.trim();
      if (!needle) return;
      const set = new Set(ids);
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) => {
          if (!set.has(b.id) || !b.url.startsWith(needle)) return b;
          return { ...b, url: to.trim() + b.url.slice(needle.length), updatedAt: Date.now() };
        }),
      }));
    },
    [commit],
  );

  /** 批量按规则重命名标题：替换子串 / 加前缀 / 加后缀 */
  const bulkRename = useCallback(
    (ids: string[], find: string, replace: string, prefix: string, suffix: string) => {
      const set = new Set(ids);
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) => {
          if (!set.has(b.id)) return b;
          let title = find ? b.title.split(find).join(replace) : b.title;
          title = `${prefix}${title}${suffix}`;
          return { ...title ? { ...b, title, updatedAt: Date.now() } : b };
        }),
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

  /* --------------------------- 分层存储 --------------------------- */
  /** 把符合条件的冷数据标记为归档（下沉 local，不占 sync 配额） */
  const archiveColdBookmarks = useCallback((idleDays: number): number => {
    if (idleDays <= 0) return 0;
    const cutoff = Date.now() - idleDays * 24 * 60 * 60 * 1000;
    let count = 0;
    commit((prev) => ({
      ...prev,
      bookmarks: prev.bookmarks.map((b) => {
        if (b.archived || b.deletedAt || b.pinned) return b;
        const last = b.visitedAt || b.updatedAt || b.createdAt;
        if (last > cutoff) return b;
        count += 1;
        return { ...b, archived: true };
      }),
      settings: { ...prev.settings, archive: { ...prev.settings.archive, lastRunAt: Date.now() } },
    }));
    return count;
  }, [commit]);

  /** 把所有归档书签取回云端（解除归档） */
  const unarchiveAll = useCallback((): number => {
    const count = stateRef.current.bookmarks.filter((b) => b.archived).length;
    if (!count) return 0;
    commit((prev) => ({
      ...prev,
      bookmarks: prev.bookmarks.map((b) => {
        if (!b.archived) return b;
        const next = { ...b };
        delete next.archived;
        return next;
      }),
    }));
    return count;
  }, [commit]);

  /** 归档集合的本地落盘：由 committed state 驱动，避免读到未刷新的 stateRef。
   *  saveState 内部也会写，但那里用的是传入快照；这里兜底保证任何 commit 后本地归档一致。 */
  const archivedKey = useMemo(
    () => state.bookmarks.filter((b) => b.archived).map((b) => `${b.id}:${b.updatedAt}`).join('|'),
    [state.bookmarks],
  );
  useEffect(() => {
    if (!ready) return;
    void saveArchivedBookmarks(state.bookmarks.filter((b) => b.archived)).catch((err) => {
      console.warn('写入本地归档失败', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, archivedKey]);

  /** 主动触发一次归档书签的本地落盘（供 UI 显式调用） */
  const flushArchive = useCallback(async () => {
    await saveArchivedBookmarks(stateRef.current.bookmarks.filter((b) => b.archived));
  }, []);

  /* --------------------------- 浏览器增量同步 --------------------------- */
  const drainBrowserRef = useRef<() => void>(() => {});
  const drainBrowserEvents = useCallback(async () => {
    if (!stateRef.current.settings.browserSync.enabled) {
      // 未开启时清空队列，避免堆积
      await clearBrowserEvents();
      return;
    }
    const events = await readBrowserEvents();
    if (!events.length) return;
    await clearBrowserEvents();
    const result = mergeBrowserEvents(stateRef.current, events);
    if (result.added || result.updated || result.removed) {
      commit(() => result.state);
    }
  }, [commit]);
  drainBrowserRef.current = () => { void drainBrowserEvents(); };

  useEffect(() => {
    if (ready) drainBrowserRef.current();
    // 浏览器书签事件写入 local，onChanged 同样能感知（Handler 见下）
  }, [ready]);

  /* --------------------------- 设置操作 --------------------------- */
  const setSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      commit((prev) => ({ ...prev, settings: { ...prev.settings, [key]: value } }));
    },
    [commit],
  );

  /**
   * 设置/清除 PIN。清除时必须原子地抹掉所有分组的 private 标记，
   * 否则分组仍被判定为锁定，而 pinHash 已不存在 → verifyPin 恒失败 → 书签永久打不开。
   * 修改 PIN（非清除）时只更新哈希，解锁会话由调用方清空。
   */
  const setPin = useCallback(
    (hash: string | undefined) => {
      commit((prev) => ({
        ...prev,
        settings: { ...prev.settings, pinHash: hash },
        groups: hash === undefined
          ? prev.groups.map((g) => (g.private ? { ...g, private: false } : g))
          : prev.groups,
      }));
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
    restoreBookmarks,
    purgeBookmarks,
    emptyTrash,
    moveBookmarksToGroup,
    addTagToBookmarks,
    bulkSetDescription,
    bulkReplaceUrl,
    bulkRename,
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
    setPin,
    importData,
    archiveColdBookmarks,
    unarchiveAll,
    flushArchive,
    manifestVersion: chrome.runtime.getManifest().version,
  };
}

export type BookmarkStore = ReturnType<typeof useBookmarkStore>;
