import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useBookmarkStore } from './store/useBookmarkStore';
import {
  buildGroupTree, findDuplicateTags, findDuplicates, getHost, groupPath, groupSubtreeIds, sortBookmarks,
} from './lib/utils';
import type { GroupNode } from './lib/utils';
import type { AppState, Bookmark, Group, SortMode } from './types';
import SyncBadge from './components/SyncBadge';
import BookmarkDialog from './components/BookmarkDialog';
import GroupDialog from './components/GroupDialog';
import DataDialog from './components/DataDialog';
import BookmarkRow from './components/BookmarkRow';
import TabsPanel from './components/TabsPanel';
import SaveToGroupMenu from './components/SaveToGroupMenu';
import GroupCreateDialog from './components/GroupCreateDialog';
import GroupSettingsDialog from './components/GroupSettingsDialog';
import { PALETTE } from './components/GroupCreateForm';
import TagDialog from './components/TagDialog';
import QuickSwitcher from './components/QuickSwitcher';
import type { SwitcherCommand } from './components/QuickSwitcher';
import type { NewBookmarkInput } from './store/useBookmarkStore';
import {
  IconSearch, IconPlus, IconGrid, IconList, IconFolder, IconTag,
  IconSun, IconMoon, IconMaximize, IconClock, IconKeyboard,
  IconBookmark, IconClose, IconTabs, IconOpenWindow, IconChevron,
  IconSparkle, IconCheck, IconMoveTo, IconTrash, IconMenu, IconSort, IconArchive,
  IconReadingList, IconPencil,
} from './components/Icons';
import SortMenu from './components/SortMenu';
import EmptyState from './components/EmptyState';
import ShortcutsDialog from './components/ShortcutsDialog';

type Panel = 'bookmarks' | 'groups' | 'data' | 'shortcuts';

export default function App() {
  const store = useBookmarkStore();
  const isOptions = window.location.pathname.includes('options');

  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string>('all');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [view, setView] = useState<'bookmarks' | 'tabs'>('bookmarks');
  const [tabCount, setTabCount] = useState(0);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  /** 新建分组时挂到哪个父分组下（null = 顶层） */
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  /** 已折叠的分组（默认全部展开） */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  /** 正在拖拽的分组 / 当前拖拽悬停的目标分组（用于侧栏整组移动） */
  const groupDragId = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null);
  /** 对话框创建成功后的回调（各入口决定自动选中/收藏等后续动作） */
  const groupCreatedHandler = useRef<((group: Group) => void) | null>(null);
  const [bookmarkDialog, setBookmarkDialog] = useState<
    { editing: Bookmark | null; preset?: { url: string; title: string } } | null
  >(null);
  /** 侧栏标签过多时的折叠开关 */
  const [tagsExpanded, setTagsExpanded] = useState(false);
  /** 嵌套分组的内联提示（只出现一次，且仅在确实有多个分组时） */
  const [nestingTip, setNestingTip] = useState(() => !localStorage.getItem('mn:tip:nesting'));
  /** 轻提示：可带一个动作按钮（撤销 / 恢复），超时自动消失 */
  const [toast, setToast] = useState<{ text: string; actionLabel?: string; action?: () => void } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  /** 多选 */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 键盘导航当前焦点 */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /** 批量操作的目标分组菜单 / 批量加标签输入框 */
  const [bulkMoveAnchor, setBulkMoveAnchor] = useState<DOMRect | null>(null);
  /** 排序菜单锚点 */
  const [sortAnchor, setSortAnchor] = useState<DOMRect | null>(null);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [bulkTag, setBulkTag] = useState('');
  /** 标签管理对话框 */
  const [tagPanelOpen, setTagPanelOpen] = useState(false);
  /** 快速切换面板（⌘K：书签 / 分组 / 命令） */
  const [switcherOpen, setSwitcherOpen] = useState(false);
  /** 当前分组设置弹窗（标题栏「管理」入口） */
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  /** 极窄面板下：侧栏收成抽屉，由顶栏按钮唤出 */
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** 侧栏宽度（可拖拽调节，0 表示用样式默认值） */
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const v = Number(localStorage.getItem('mn:sidebarWidth'));
    return Number.isFinite(v) && v >= 130 ? v : 0;
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const dragId = useRef<string | null>(null);

  const { bookmarks, groups, settings } = store.state;
  /** 始终指向最新 store，供事件监听/延时回调使用（避免闭包过期和监听器频繁重绑） */
  const storeRef = useRef(store);
  storeRef.current = store;

  /* --------------------------- 主题 --------------------------- */
  useEffect(() => {
    const root = document.documentElement;
    const apply = (dark: boolean) => root.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches);
      const listener = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
    apply(settings.theme === 'dark');
  }, [settings.theme]);

  /* --------------------------- 窄面板抽屉 --------------------------- */
  useEffect(() => {
    const onResize = () => { if (window.innerWidth > 470) setDrawerOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  /* --------------------------- 提示 --------------------------- */
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text: msg });
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  /** 带「撤销」的提示：删除类操作先执行再给用户一次反悔机会 */
  const showUndo = useCallback((msg: string, undo: () => void) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text: msg, actionLabel: '撤销', action: undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, []);

  /** 带自定义动作的提示（如「恢复我的版本」） */
  const showAction = useCallback((msg: string, label: string, action: () => void) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text: msg, actionLabel: label, action });
    toastTimer.current = window.setTimeout(() => setToast(null), 8000);
  }, []);

  /* ------------------------ 多级撤销（⌘Z） ------------------------ */
  /** 撤销栈：记录每个可逆操作前的完整状态快照，⌘Z 逐步回退 */
  const undoStack = useRef<{ state: AppState; label: string }[]>([]);
  /** 在改动前调用：把当前完整状态压入撤销栈（保留最近 20 步），返回该快照供即时撤销复用 */
  const pushUndo = useCallback((label: string): AppState => {
    const snapshot = storeRef.current.state;
    undoStack.current = [...undoStack.current, { state: snapshot, label }].slice(-20);
    return snapshot;
  }, []);

  const performUndo = useCallback(() => {
    const last = undoStack.current.pop();
    if (!last) {
      showToast('没有可撤销的操作');
      return;
    }
    storeRef.current.importData(last.state);
    showToast(`已撤销：${last.label}`);
  }, [showToast]);


  /**
   * 复制文本：优先 Clipboard API；失败时退回 execCommand，
   * 保证在没有剪贴板权限的容器里也能复制成功。
   */
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  };

  /**
   * 打开「新建书签」对话框。
   * 浏览器扩展里最高频的动作是收藏当前页，所以只要当前有 http(s) 标签页，
   * 就先把它的网址与标题填进去，用户只需补分组/标签（或直接回车保存）。
   */
  const openAddDialog = useCallback(() => {
    const open = (preset?: { url: string; title: string }) =>
      setBookmarkDialog({ editing: null, preset });
    const tabsApi = (globalThis as { chrome?: typeof chrome }).chrome?.tabs;
    if (!tabsApi?.query) {
      open();
      return;
    }
    tabsApi
      .query({ active: true, currentWindow: true })
      .then((list) => {
        const tab = list?.[0];
        const url = tab?.url ?? '';
        // 空白页 / 扩展页 / chrome:// 没有收藏价值，退回空表单
        if (tab && /^https?:/i.test(url)) open({ url, title: tab.title ?? '' });
        else open();
      })
      .catch(() => open());
  }, []);

  /* ------------------------ 快速切换面板 ------------------------ */
  const browseTo = useCallback((group: string, tag: string | null = null) => {
    setView('bookmarks');
    setActiveGroup(group);
    setActiveTag(tag);
    setQuery('');
  }, []);

  const switcherCommands = useMemo<SwitcherCommand[]>(() => [
    { id: 'new', label: '新建书签', run: openAddDialog },
    {
      id: 'theme',
      label: settings.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题',
      run: () => storeRef.current.setTheme(settings.theme === 'dark' ? 'light' : 'dark'),
    },
    { id: 'groups', label: '管理分组', run: () => setPanel('groups') },
    { id: 'data', label: '数据与整理', run: () => setPanel('data') },
    { id: 'shortcuts', label: '查看快捷键', run: () => setPanel('shortcuts') },
    { id: 'recent-added', label: '浏览最近添加', run: () => browseTo('recent-added') },
    { id: 'recent', label: '浏览最近访问', run: () => browseTo('recent') },
    { id: 'read-later', label: '浏览阅读清单', run: () => browseTo('read-later') },
    { id: 'all', label: '浏览全部书签', run: () => browseTo('all') },
    { id: 'ungrouped', label: '浏览未分组书签', run: () => browseTo('ungrouped') },
    {
      id: 'tabs',
      label: '查看当前标签页',
      run: () => { setView('tabs'); setActiveTag(null); setQuery(''); },
    },
  ], [settings.theme, openAddDialog, browseTo]);

  const handleSwitcherBookmark = useCallback((bm: Bookmark) => {
    storeRef.current.visitBookmark(bm.id, bm.url);
  }, []);

  const handleSwitcherGroup = useCallback((g: Group) => {
    browseTo(g.id);
  }, [browseTo]);

  /* ------------------------ 派生数据 ------------------------ */
  const groupById = useMemo(() => {
    const m = new Map<string, (typeof groups)[number]>();
    groups.forEach((g) => m.set(g.id, g));
    return m;
  }, [groups]);

  const groupTree = useMemo(() => buildGroupTree(groups), [groups]);

  /** 每个分组包含其后代的书签总数（父分组计数覆盖整棵子树） */
  const groupCounts = useMemo(() => {
    const own: Record<string, number> = {};
    bookmarks.forEach((b) => {
      if (b.groupId) own[b.groupId] = (own[b.groupId] ?? 0) + 1;
    });
    const total: Record<string, number> = {};
    groups.forEach((g) => {
      let n = 0;
      groupSubtreeIds(groups, g.id).forEach((id) => { n += own[id] ?? 0; });
      total[g.id] = n;
    });
    return total;
  }, [bookmarks, groups]);

  /** 分组 → 自身及全部后代 id（用于筛选与「整组操作」） */
  const subtreeMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    groups.forEach((g) => m.set(g.id, groupSubtreeIds(groups, g.id)));
    return m;
  }, [groups]);

  /** 侧栏可见的分组行（按层级展开，折叠的子树整段隐藏） */
  const groupNavRows = useMemo(() => {
    const out: { node: GroupNode; depth: number }[] = [];
    const walk = (nodes: GroupNode[], depth: number) => {
      nodes.forEach((node) => {
        out.push({ node, depth });
        if (!collapsedGroups.has(node.group.id)) walk(node.children, depth + 1);
      });
    };
    walk(groupTree, 0);
    return out;
  }, [groupTree, collapsedGroups]);

  /** 当前分组的层级路径（用于标题下方的面包屑） */
  const activeGroupPath = useMemo(
    () => (activeGroup !== 'all' && activeGroup !== 'ungrouped'
      ? groupPath(groups, activeGroup)
      : []),
    [activeGroup, groups],
  );

  /** 分组 id → 完整层级路径文本（搜索、卡片 tooltip 用） */
  const groupPathText = useMemo(() => {
    const m = new Map<string, string>();
    groups.forEach((g) => m.set(g.id, groupPath(groups, g.id).map((p) => p.name).join(' / ')));
    return m;
  }, [groups]);

  /** 标签 → 使用次数（标签管理面板用） */
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    bookmarks.forEach((b) => b.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return Array.from(m.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
  }, [bookmarks]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    bookmarks.forEach((b) => b.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [bookmarks]);

  const duplicates = useMemo(() => findDuplicates(bookmarks), [bookmarks]);

  /** 阅读清单未读数量（侧栏角标） */
  const unreadCount = useMemo(
    () => bookmarks.filter((b) => b.readLater).length,
    [bookmarks],
  );

  /** 语义重复的标签组（仅大小写/全半角/空白差异） */
  const duplicateTags = useMemo(
    () => findDuplicateTags(bookmarks),
    [bookmarks],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const subtree = activeGroup !== 'all' && activeGroup !== 'ungrouped'
      && activeGroup !== 'recent' && activeGroup !== 'recent-added'
      && activeGroup !== 'read-later'
      ? subtreeMap.get(activeGroup)
      : null;
    let items = bookmarks.filter((b) => {
      if (activeGroup === 'ungrouped' && b.groupId) return false;
      if (subtree) {
        // 选中父分组时，同时展示所有嵌套子分组里的书签
        if (!b.groupId || !subtree.has(b.groupId)) return false;
      }
      if (activeTag && !b.tags.includes(activeTag)) return false;
      if (q) {
        const hay = `${b.title} ${b.url} ${getHost(b.url)} ${b.description} ${b.tags.join(' ')} ${
          b.groupId ? groupPathText.get(b.groupId) ?? '' : ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // 快捷视图：最近添加 / 最近访问 / 阅读清单
    if (activeGroup === 'recent-added') {
      return [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
    }
    if (activeGroup === 'recent') {
      return items
        .filter((b) => b.visitedAt > 0)
        .sort((a, b) => b.visitedAt - a.visitedAt)
        .slice(0, 50);
    }
    if (activeGroup === 'read-later') {
      return items
        .filter((b) => b.readLater)
        .sort((a, b) => b.createdAt - a.createdAt);
    }
    items = sortBookmarks(items, settings.sort);
    return items;
  }, [bookmarks, query, activeGroup, activeTag, settings.sort, subtreeMap, groupPathText]);

  /* ------------------------ 多选 ------------------------ */
  const isRealGroup = (id: string) => groupById.has(id);

  const toggleSelect = useCallback((bm: Bookmark) => {
    setSelectMode(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bm.id)) next.delete(bm.id);
      else next.add(bm.id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectMode(true);
    setSelectedIds(new Set(filtered.map((b) => b.id)));
  }, [filtered]);

  // 不在当前筛选结果里的选中项自动剔除，避免「已选 3 个」却看不见
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(filtered.map((b) => b.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [filtered]);

  /* ------------------------ 键盘快捷键 ------------------------ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
        || target.isContentEditable;
      // 快速切换面板打开时，键盘事件全部交给面板自身处理
      if (switcherOpen) return;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSwitcherOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === 'a' && !typing && !panel && view === 'bookmarks') {
        e.preventDefault();
        selectAll();
        return;
      }
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openAddDialog();
        return;
      }
      // 多级撤销：⌘Z 逐步回退（输入框内的文本撤销交给原生行为）
      if (mod && e.key.toLowerCase() === 'z' && !typing && !panel && view === 'bookmarks') {
        e.preventDefault();
        performUndo();
        return;
      }
      // 列表键盘导航（仅书签视图、非输入态、无弹窗时）
      if (!typing && !panel && view === 'bookmarks' && filtered.length > 0) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const dir = e.key === 'ArrowDown' ? 1 : -1;
          const idx = filtered.findIndex((b) => b.id === focusedId);
          const nextIdx = idx < 0
            ? (dir === 1 ? 0 : filtered.length - 1)
            : Math.min(filtered.length - 1, Math.max(0, idx + dir));
          setFocusedId(filtered[nextIdx].id);
          return;
        }
        if (e.key === 'Enter' && focusedId) {
          const bm = filtered.find((b) => b.id === focusedId);
          if (bm) {
            e.preventDefault();
            storeRef.current.visitBookmark(bm.id, bm.url);
            return;
          }
        }
        if (e.key.toLowerCase() === 'x' && !mod) {
          const bm = filtered.find((b) => b.id === focusedId) ?? filtered[0];
          if (bm) {
            e.preventDefault();
            toggleSelect(bm);
            return;
          }
        }
      }
      if (e.key === 'Escape') {
        if (selectMode) {
          clearSelection();
          return;
        }
        if (panel) setPanel(null);
        else if (query) setQuery('');
        else if (activeTag) setActiveTag(null);
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, query, activeTag, focusedId, filtered, selectMode, selectAll, clearSelection, toggleSelect, view, openAddDialog, performUndo, switcherOpen]);

  // 键盘焦点卡片滚入可视区
  useEffect(() => {
    if (!focusedId) return;
    const el = document.querySelector(`[data-bm-id="${focusedId}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedId]);

  // 同步失败：给一条带「重试」的提示（徽章在窄面板里只剩一个小点，容易被忽略）
  const syncErrShown = useRef(false);
  useEffect(() => {
    if (store.sync.phase !== 'error') {
      syncErrShown.current = false;
      return;
    }
    if (syncErrShown.current) return;
    syncErrShown.current = true;
    showAction(store.sync.message || '同步失败', '重试', () => {
      const s = storeRef.current;
      s.setSetting('theme', s.state.settings.theme);
    });
  }, [store.sync.phase, store.sync.message, showAction]);

  // 同步冲突：本地未落盘的改动被其他设备覆盖时，给一个恢复入口（只提示一次）
  const conflictShown = useRef(false);
  useEffect(() => {
    if (!store.conflictBackup) {
      conflictShown.current = false;
      return;
    }
    if (conflictShown.current) return;
    conflictShown.current = true;
    showAction('其他设备的更新覆盖了你未保存的改动', '恢复我的版本', () => {
      storeRef.current.restoreConflict();
    });
  }, [store.conflictBackup, showAction]);

  /* -------------------------- 操作 -------------------------- */
  const refresh = () => {
    showToast('正在重新同步…');
    // 触发一次轻量写入以刷新时间戳，同时让 onChanged 广播
    store.setSetting('theme', settings.theme);
  };

  const handleSaveBookmark = (data: {
    title: string; url: string; description: string; groupId: string | null; tags: string[];
  }) => {
    if (bookmarkDialog?.editing) {
      store.updateBookmark(bookmarkDialog.editing.id, data);
      showToast('书签已更新');
    } else {
      void store.addBookmark(data).then((bm) => {
        showToast(bm ? '书签已添加并同步' : '同步空间不足：书签未能保存，请先清理或备份');
      });
    }
    setBookmarkDialog(null);
  };

  /** 所有入口统一请求新建分组：记录后续回调并打开对话框 */
  const requestCreateGroup = useCallback(
    (onDone?: (group: Group) => void, parentId: string | null = null) => {
      groupCreatedHandler.current = onDone ?? null;
      setCreateParentId(parentId);
      setCreateGroupOpen(true);
    },
    [],
  );

  /** 统一对话框提交：落库 → 通知各入口 → 关闭 */
  const handleGroupCreated = (name: string, color: string) => {
    const group = store.addGroup({ name, color, parentId: createParentId });
    const parentName = createParentId ? groupById.get(createParentId)?.name : '';
    showToast(parentName ? `已在「${parentName}」下创建「${group.name}」` : `分组「${group.name}」已创建`);
    const done = groupCreatedHandler.current;
    groupCreatedHandler.current = null;
    setCreateParentId(null);
    setCreateGroupOpen(false);
    done?.(group);
  };

  /** 整组移动：把分组挂到另一个分组下（null = 移到顶层） */
  const handleMoveGroup = (id: string, parentId: string | null) => {
    const name = groupById.get(id)?.name ?? '分组';
    const ok = store.moveGroup(id, parentId);
    if (!ok) {
      showToast('不能把分组移动到它自己或它的子分组里');
      return;
    }
    pushUndo(parentId ? `移动分组「${name}」` : `把「${name}」移回顶层`);
    const target = parentId ? groupById.get(parentId)?.name : '';
    showToast(target ? `已将「${name}」移动到「${target}」` : `已将「${name}」移到顶层`);
  };

  const toggleGroupCollapsed = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 选中嵌套分组时自动展开其所有父级，避免「选中项看不见」
  useEffect(() => {
    if (activeGroup === 'all' || activeGroup === 'ungrouped') return;
    const path = groupPath(groups, activeGroup);
    if (path.length < 2) return;
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      let changed = false;
      path.slice(0, -1).forEach((g) => {
        if (next.delete(g.id)) changed = true;
      });
      return changed ? next : prev;
    });
  }, [activeGroup, groups]);

  const handleMoveToGroup = (id: string, groupId: string | null) => {
    const target = bookmarks.find((b) => b.id === id);
    const name = groupId === null ? '未分组' : groupById.get(groupId)?.name ?? '分组';
    pushUndo(target ? `把「${target.title}」移到「${name}」` : `移动书签到「${name}」`);
    // 只改 groupId、保留原有顺序与位置（moveBookmark 会把书签挪到列表末尾，不适合此场景）
    store.updateBookmark(id, { groupId });
    showToast(`已移动到「${name}」`);
  };

  /* ------------------------ 批量操作 ------------------------ */
  const handleBulkMove = (groupId: string | null) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const name = groupId === null ? '未分组' : groupById.get(groupId)?.name ?? '分组';
    const snapshot = pushUndo(`移动 ${ids.length} 个书签到「${name}」`);
    store.moveBookmarksToGroup(ids, groupId);
    clearSelection();
    showUndo(`已将 ${ids.length} 个书签移动到「${name}」`, () => store.importData(snapshot));
  };

  const handleBulkTag = (tag: string) => {
    const t = tag.trim();
    if (!t || selectedIds.size === 0) return;
    const snapshot = pushUndo(`给 ${selectedIds.size} 个书签加标签「${t}」`);
    store.addTagToBookmarks(Array.from(selectedIds), t);
    setBulkTag('');
    setBulkTagOpen(false);
    showUndo(`已给 ${selectedIds.size} 个书签加上「${t}」`, () => store.importData(snapshot));
  };

  const handleDeleteBookmark = (bm: Bookmark, label?: string) => {
    const snapshot = pushUndo(`删除「${bm.title}」`);
    store.deleteBookmark(bm.id);
    showUndo(label ?? `已删除「${bm.title}」`, () => store.importData(snapshot));
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const snapshot = pushUndo(`删除 ${ids.length} 个书签`);
    store.deleteBookmarks(ids);
    clearSelection();
    showUndo(`已删除 ${ids.length} 个书签`, () => store.importData(snapshot));
  };

  /* ------------------------ 侧栏宽度拖拽 ------------------------ */
  const startSidebarResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const aside = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
    const startX = e.clientX;
    const startW = aside?.getBoundingClientRect().width ?? 150;
    const onMove = (ev: MouseEvent) => {
      const max = Math.max(200, Math.min(360, window.innerWidth - 260));
      const next = Math.round(Math.min(max, Math.max(130, startW + ev.clientX - startX)));
      setSidebarWidth(next);
      localStorage.setItem('mn:sidebarWidth', String(next));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('is-resizing');
    };
    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** 在新浏览器窗口打开指定分组下的所有书签链接（含嵌套子分组） */
  const handleOpenGroupWindow = (groupId: string | null) => {
    const ids = groupId && groupId !== 'all' && groupId !== 'ungrouped'
      ? subtreeMap.get(groupId) ?? new Set([groupId])
      : null;
    const urls = bookmarks
      .filter((b) => {
        if (groupId === 'all') return true;
        if (groupId === 'ungrouped') return !b.groupId;
        if (!b.groupId) return false;
        return ids ? ids.has(b.groupId) : b.groupId === groupId;
      })
      .map((b) => b.url)
      .filter((url) => /^https?:\/\//i.test(url));
    if (urls.length === 0) {
      showToast('该分组下没有可打开的链接');
      return;
    }
    chrome.windows.create({ url: urls.slice(0, 100), focused: true })
      .then(() => showToast(`已在新窗口打开 ${Math.min(urls.length, 100)} 个标签`))
      .catch(() => showToast('打开窗口失败，请检查浏览器设置'));
  };

  const handleAddFromTab = async (input: NewBookmarkInput) => {
    const bm = await store.addBookmark(input);
    showToast(bm ? '已从标签页收藏' : '同步空间不足：该书签未能保存，请先清理或备份数据');
  };

  const handleAddManyFromTabs = async (inputs: NewBookmarkInput[]) => {
    const n = await store.addBookmarks(inputs);
    if (n > 0) showToast(`已收藏 ${n} 个标签页并同步`);
    else if (n < 0) {
      showToast('同步空间不足：本次批量收藏会超出 100 KB 上限，请先导出备份并清理书签');
      setPanel('data');
    } else showToast('没有需要收藏的标签页');
  };

  const handleOpenTab = (tabId: number, windowId?: number) => {
    // 先聚焦标签页所在的窗口，再激活标签页。
    // 跨窗口时只调用 tabs.update 只会让目标窗口内的标签变为活动态，
    // 但窗口本身不会获得焦点，用户看不到任何变化（表现为「按钮没作用」）。
    const activate = () => chrome.tabs.update(tabId, { active: true });
    if (windowId != null) {
      chrome.windows.update(windowId, { focused: true }).then(activate).catch(() => activate());
    } else {
      chrome.tabs.get(tabId).then((tab) => {
        if (tab.windowId != null) {
          chrome.windows.update(tab.windowId, { focused: true }).then(activate).catch(() => activate());
        } else {
          activate();
        }
      }).catch(() => activate());
    }
  };

  /**
   * 读取浏览器书签树。
   * chrome.bookmarks 需要 manifest 里的 "bookmarks" 权限；
   * 旧版本安装的扩展没有该权限时 API 直接是 undefined，
   * 这里统一转成可读的错误，避免上层只显示一句「失败」。
   */
  const readBrowserBookmarks = () =>
    new Promise<chrome.bookmarks.BookmarkTreeNode[]>((resolve, reject) => {
      const api = (globalThis as { chrome?: typeof chrome }).chrome?.bookmarks;
      if (!api || typeof api.getTree !== 'function') {
        reject(new Error('MISSING_BOOKMARKS_PERMISSION'));
        return;
      }
      let settled = false;
      const ok = (nodes?: chrome.bookmarks.BookmarkTreeNode[]) => {
        if (settled) return;
        settled = true;
        resolve(nodes ?? []);
      };
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      try {
        // 同时兼容两种调用风格：老版本只走回调，新版本可能只返回 Promise
        const maybePromise = api.getTree((nodes) => {
          const lastError = chrome.runtime?.lastError;
          if (lastError) fail(new Error(lastError.message || 'BOOKMARKS_API_ERROR'));
          else ok(nodes);
        }) as unknown as Promise<chrome.bookmarks.BookmarkTreeNode[]> | undefined;
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(ok).catch(fail);
        }
      } catch (err) {
        fail(err);
      }
    });

  /**
   * 从 Chrome 导入：把书签文件夹树映射为分组树（支持嵌套），网址去重。
   * 同名同层分组会复用已存在的分组，重复导入不会堆出多套树。
   */
  const handleImportBrowser = async () => {
    const existing = new Set(bookmarks.map((b) => b.url.replace(/\/+$/, '')));
    const tree = await readBrowserBookmarks();
    const now = Date.now();
    const newGroups: Group[] = [];
    const newItems: Bookmark[] = [];
    let imported = 0;
    let skipped = 0;
    let unsupported = 0;

    const keyOf = (parentId: string | null, name: string) => `${parentId ?? 'root'}|${name}`;
    const pool = new Map<string, string>();
    groups.forEach((g) => pool.set(keyOf(g.parentId, g.name), g.id));

    // Chrome 的固定根容器（书签栏 / 其他书签 / 移动设备书签）只是容器，
    // 不该变成分组，其子项按顶层处理。
    const ROOT_IDS = new Set(['0', '1', '2', '3']);
    const ROOT_NAMES = /^(书签栏|其他书签|移動書籤|移动设备书签|bookmarks\s*bar|other\s*bookmarks|mobile\s*bookmarks)$/i;
    const isRootContainer = (node: chrome.bookmarks.BookmarkTreeNode) => {
      if (node.url) return false;
      const title = (node.title ?? '').trim();
      return ROOT_IDS.has(node.id) || node.parentId === '0' || ROOT_NAMES.test(title);
    };

    const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[], parentGroupId: string | null) => {
      for (const node of nodes) {
        if (node.url) {
          // 只收可点击的网页链接；chrome:// / file:// / javascript: 之类跳过并单独计数
          if (!/^https?:/i.test(node.url)) {
            unsupported += 1;
            continue;
          }
          const norm = node.url.replace(/\/+$/, '');
          if (existing.has(norm)) {
            skipped += 1;
            continue;
          }
          existing.add(norm);
          newItems.push({
            id: crypto.randomUUID(),
            title: node.title || getHost(node.url),
            url: node.url,
            description: '',
            groupId: parentGroupId,
            tags: [],
            favicon: '',
            createdAt: now + imported,
            updatedAt: now + imported,
            visitedAt: 0,
            visits: 0,
            pinned: false,
            order: now + imported,
          });
          imported += 1;
          continue;
        }
        // 根容器 / 无标题的容器：只往下走，不建分组
        if (isRootContainer(node) || !(node.title ?? '').trim()) {
          if (node.children) walk(node.children, parentGroupId);
          continue;
        }
        // 普通文件夹 → 分组（保留层级）
        const name = (node.title ?? '').trim();
        const key = keyOf(parentGroupId, name);
        let gid = pool.get(key);
        if (!gid) {
          const g: Group = {
            id: crypto.randomUUID(),
            name,
            color: PALETTE[newGroups.length % PALETTE.length],
            createdAt: now,
            order: now + newGroups.length,
            parentId: parentGroupId,
          };
          newGroups.push(g);
          pool.set(key, g.id);
          gid = g.id;
        }
        if (node.children) walk(node.children, gid);
      }
    };

    tree.forEach((root) => walk(root.children ?? [], null));

    if (newItems.length || newGroups.length) {
      store.importData({
        ...store.state,
        groups: [...store.state.groups, ...newGroups],
        bookmarks: [...store.state.bookmarks, ...newItems],
      });
      // 导入完成直接把用户带到「最近添加」，让人看到东西落在哪里
      setPanel(null);
      setView('bookmarks');
      setActiveGroup('recent-added');
      setActiveTag(null);
      setQuery('');
      const parts = [`已导入 ${imported} 个书签`];
      if (newGroups.length) parts.push(`${newGroups.length} 个分组`);
      if (skipped) parts.push(`跳过 ${skipped} 个重复`);
      showToast(parts.join('，'));
    }
    return { imported, skipped, unsupported, groups: newGroups.length };
  };

  /** 空状态里的「导入浏览器书签」：失败时给出可执行的提示，而不是静默 */
  const importFromEmptyState = async () => {
    try {
      await handleImportBrowser();
    } catch (err) {
      const detail = err instanceof Error ? err.message : '';
      showToast(
        detail === 'MISSING_BOOKMARKS_PERMISSION'
          ? '扩展缺少书签权限：请在 chrome://extensions 重新加载后再试'
          : '读取浏览器书签失败，可在「数据与整理」里查看原因',
      );
    }
  };

  if (!store.ready) {
    return (
      <div className="app app--loading">
        <div className="skeleton-brand" />
        <div className="skeleton skeleton--search" />
        <div className="skeleton-list">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton skeleton--row" style={{ opacity: 1 - i * 0.12 }} />
          ))}
        </div>
      </div>
    );
  }

  const sortLabels: Record<SortMode, string> = {
    manual: '自定义', recent: '最近更新', title: '标题', visits: '访问次数',
  };

  return (
    <div className={`app ${isOptions ? 'app--wide' : ''}`}>
      <header className="topbar">
        <button
          className="icon-btn topbar__menu"
          onClick={() => setDrawerOpen((v) => !v)}
          aria-label="打开导航"
          aria-expanded={drawerOpen}
          title="导航"
        >
          <IconMenu size={17} />
        </button>
        <div className="brand">
          <span className="brand__mark"><IconBookmark size={17} /></span>
          <div className="brand__text">
            <strong>Marknest</strong>
            <span>书签管家</span>
          </div>
        </div>
        <SyncBadge sync={store.sync} onRefresh={refresh} />
        <div className="topbar__actions">
          <button
            className="icon-btn"
            onClick={() => store.setTheme(settings.theme === 'dark' ? 'light' : 'dark')}
            title={settings.theme === 'dark' ? '切换到浅色' : '切换到深色'}
            aria-label="切换主题"
          >
            {settings.theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              if (isOptions) {
                // 全窗口模式：通过当前活动标签拿到 windowId 再打开侧边栏
                chrome.tabs
                  .query({ active: true, currentWindow: true })
                  .then((tabs) => {
                    const wid = tabs[0]?.windowId;
                    if (wid != null) return chrome.sidePanel.open({ windowId: wid });
                  })
                  .catch(() => {});
              } else {
                chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
              }
            }}
            title={isOptions ? '打开侧边栏' : '在大窗口中打开'}
            aria-label={isOptions ? '打开侧边栏' : '在大窗口中打开'}
          >
            <IconMaximize size={17} />
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={openAddDialog}
            title="添加书签（自动填入当前页面）"
          >
            <IconPlus size={15} /> <span>添加</span>
          </button>
        </div>
      </header>

      <div className="searchbar">
        <IconSearch size={17} className="searchbar__icon" />
        <input
          ref={searchRef}
          className="searchbar__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索标题、网址、标签或备注…"
          aria-label="搜索书签"
        />
        {query ? (
          <button className="icon-btn icon-btn--sm" onClick={() => setQuery('')} aria-label="清除搜索">
            <IconClose size={15} />
          </button>
        ) : (
          <kbd className="kbd">/</kbd>
        )}
      </div>

      <div className="layout">
        {drawerOpen && (
          <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden />
        )}
        <aside
          className={`sidebar ${drawerOpen ? 'is-open' : ''}`}
          style={sidebarWidth ? { width: sidebarWidth } : undefined}
          onClick={(e) => {
            // 抽屉模式下选中导航项 / 点新建后自动收起
            if ((e.target as HTMLElement).closest('.nav-item, .sidebar__add')) setDrawerOpen(false);
          }}
        >
          <div className="drawer-head">
            <span className="brand__mark"><IconBookmark size={16} /></span>
            <strong>Marknest</strong>
            <button className="icon-btn icon-btn--sm" onClick={() => setDrawerOpen(false)} aria-label="关闭导航">
              <IconClose size={16} />
            </button>
          </div>
          <div className="sidebar__section">
            <p className="sidebar__label">浏览</p>
            <button
              className={`nav-item ${view === 'tabs' ? 'nav-item--active' : ''}`}
              onClick={() => { setView('tabs'); setActiveTag(null); setQuery(''); }}
            >
              <IconTabs size={15} />
              <span>当前标签页</span>
              <em>{tabCount || ''}</em>
            </button>
            <button
              className={`nav-item ${view === 'bookmarks' && activeGroup === 'recent-added' ? 'nav-item--active' : ''}`}
              onClick={() => { setView('bookmarks'); setActiveGroup('recent-added'); setActiveTag(null); }}
              title="最近添加的 50 个书签"
            >
              <IconSparkle size={15} />
              <span>最近添加</span>
            </button>
            <button
              className={`nav-item ${view === 'bookmarks' && activeGroup === 'recent' ? 'nav-item--active' : ''}`}
              onClick={() => { setView('bookmarks'); setActiveGroup('recent'); setActiveTag(null); }}
              title="最近在 Marknest 里打开过的 50 个书签"
            >
              <IconClock size={15} />
              <span>最近访问</span>
            </button>
            <button
              className={`nav-item ${view === 'bookmarks' && activeGroup === 'read-later' ? 'nav-item--active' : ''}`}
              onClick={() => { setView('bookmarks'); setActiveGroup('read-later'); setActiveTag(null); }}
              title="标记为「稍后阅读」的书签，打开后自动移出"
            >
              <IconReadingList size={15} />
              <span>阅读清单</span>
              <em>{unreadCount || ''}</em>
            </button>
          </div>

          <div className="sidebar__section">
            <div
              className={`sidebar__label-row ${dropTarget === 'root' ? 'is-drop-root' : ''}`}
              title="把分组拖到此处可移到顶层"
              onDragOver={(e) => {
                if (!groupDragId.current) return;
                e.preventDefault();
                setDropTarget('root');
              }}
              onDragLeave={() => setDropTarget((t) => (t === 'root' ? null : t))}
              onDrop={(e) => {
                e.preventDefault();
                const drag = groupDragId.current;
                groupDragId.current = null;
                setDropTarget(null);
                if (drag) handleMoveGroup(drag, null);
              }}
            >
              <p className="sidebar__label">分组</p>
              <button
                className={`sidebar__add sidebar__add--text ${isRealGroup(activeGroup) ? 'is-child' : ''}`}
                onClick={() => {
                  // 正在浏览某个分组时，新建的分组自动成为它的子分组
                  const parentId = isRealGroup(activeGroup) ? activeGroup : null;
                  requestCreateGroup((g) => {
                    setActiveGroup(g.id);
                    setView('bookmarks');
                    setActiveTag(null);
                  }, parentId);
                }}
                title={
                  isRealGroup(activeGroup)
                    ? `在「${groupById.get(activeGroup)?.name ?? ''}」下新建子分组`
                    : '新建分组'
                }
                aria-label={
                  isRealGroup(activeGroup)
                    ? `在「${groupById.get(activeGroup)?.name ?? ''}」下新建子分组`
                    : '新建分组'
                }
              >
                <IconPlus size={12} />
                <span>{isRealGroup(activeGroup) ? '子分组' : '新建'}</span>
              </button>
            </div>
            {nestingTip && groups.length >= 2 && (
              <div className="sidebar__tip" role="note">
                <span>把分组拖到另一个分组上，就能嵌套成子分组</span>
                <button
                  className="sidebar__tip-x"
                  onClick={() => {
                    localStorage.setItem('mn:tip:nesting', '1');
                    setNestingTip(false);
                  }}
                  aria-label="知道了"
                  title="知道了"
                >
                  <IconClose size={11} />
                </button>
              </div>
            )}
            <div className="nav-group">
              <button
                className={`nav-item ${view === 'bookmarks' && activeGroup === 'all' ? 'nav-item--active' : ''}`}
                onClick={() => { setView('bookmarks'); setActiveGroup('all'); setActiveTag(null); }}
              >
                <IconBookmark size={15} />
                <span>全部书签</span>
                <em>{bookmarks.length}</em>
              </button>
              <button
                className="nav-group__open"
                onClick={() => handleOpenGroupWindow('all')}
                title="在新窗口打开全部书签"
                aria-label="在新窗口打开全部书签"
              >
                <IconOpenWindow size={12} />
              </button>
            </div>
            <div
              className={`nav-group ${dropTarget === 'ungrouped' ? 'nav-group--drop' : ''}`}
              onDragOver={(e) => {
                if (!dragId.current) return;
                e.preventDefault();
                setDropTarget('ungrouped');
              }}
              onDragLeave={() => setDropTarget((t) => (t === 'ungrouped' ? null : t))}
              onDrop={(e) => {
                const id = dragId.current;
                if (!id) return;
                e.preventDefault();
                dragId.current = null;
                setDropTarget(null);
                handleMoveToGroup(id, null);
              }}
            >
              <button
                className={`nav-item ${view === 'bookmarks' && activeGroup === 'ungrouped' ? 'nav-item--active' : ''}`}
                onClick={() => { setView('bookmarks'); setActiveGroup('ungrouped'); setActiveTag(null); }}
                title="把书签拖到这里可移出分组"
              >
                <IconFolder size={15} />
                <span>未分组</span>
                <em>{bookmarks.filter((b) => !b.groupId).length}</em>
              </button>
              <button
                className="nav-group__open"
                onClick={() => handleOpenGroupWindow('ungrouped')}
                title="在新窗口打开未分组的书签"
                aria-label="在新窗口打开未分组的书签"
              >
                <IconOpenWindow size={12} />
              </button>
            </div>
            {groupNavRows.map(({ node, depth }) => {
              const g = node.group;
              const hasChildren = node.children.length > 0;
              const isCollapsed = collapsedGroups.has(g.id);
              return (
                <div
                  key={g.id}
                  className={`nav-group ${depth ? 'nav-group--child' : ''} ${dropTarget === g.id ? 'nav-group--drop' : ''}`}
                  style={depth ? { marginLeft: depth * 12 } : undefined}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', g.id);
                    groupDragId.current = g.id;
                  }}
                  onDragEnd={() => { groupDragId.current = null; setDropTarget(null); }}
                  onDragOver={(e) => {
                    // 分组拖到分组上 = 整组嵌套；书签拖到分组上 = 归入该分组
                    const draggingGroup = groupDragId.current;
                    const draggingBm = dragId.current;
                    if (!draggingGroup && !draggingBm) return;
                    if (draggingGroup === g.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDropTarget(g.id);
                  }}
                  onDragLeave={() => setDropTarget((t) => (t === g.id ? null : t))}
                  onDrop={(e) => {
                    const bmId = dragId.current;
                    const grpId = groupDragId.current;
                    if (!bmId && !grpId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    dragId.current = null;
                    groupDragId.current = null;
                    setDropTarget(null);
                    if (bmId) handleMoveToGroup(bmId, g.id);
                    else if (grpId && grpId !== g.id) handleMoveGroup(grpId, g.id);
                  }}
                >
                  {hasChildren ? (
                    <button
                      className={`nav-item__chev ${isCollapsed ? '' : 'is-open'}`}
                      onClick={() => toggleGroupCollapsed(g.id)}
                      aria-label={isCollapsed ? `展开「${g.name}」` : `折叠「${g.name}」`}
                      aria-expanded={!isCollapsed}
                    >
                      <IconChevron size={10} />
                    </button>
                  ) : null}
                  <button
                    className={`nav-item ${view === 'bookmarks' && activeGroup === g.id ? 'nav-item--active' : ''}`}
                    /* 统一 18px 左内边距：有无折叠箭头，圆点都在同一竖线上 */
                    style={{ paddingLeft: 18 }}
                    onClick={() => { setView('bookmarks'); setActiveGroup(g.id); setActiveTag(null); }}
                    title={depth ? groupPath(groups, g.id).map((p) => p.name).join(' / ') : g.name}
                  >
                    <IconFolder size={15} style={{ color: g.color, flexShrink: 0 }} />
                    <span className="nav-item__name">{g.name}</span>
                    <em>{groupCounts[g.id] ?? 0}</em>
                  </button>
                  <button
                    className="nav-group__open"
                    onClick={() => handleOpenGroupWindow(g.id)}
                    title={`在新窗口打开「${g.name}」的所有标签`}
                    aria-label={`在新窗口打开「${g.name}」的所有标签`}
                  >
                    <IconOpenWindow size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {allTags.length > 0 && (
            <div className="sidebar__section">
              <div className="sidebar__label-row">
                <p className="sidebar__label">标签</p>
                <button
                  className="sidebar__add sidebar__add--text"
                  onClick={() => setTagPanelOpen(true)}
                  title="管理标签（重命名 / 合并 / 删除）"
                  aria-label="管理标签"
                >
                  <IconTag size={11} />
                  <span>管理</span>
                </button>
              </div>
              <div className="sidebar__tags">
                {(tagsExpanded ? allTags : allTags.slice(0, 8)).map((t) => (
                  <button
                    key={t}
                    className={`tag-pill ${activeTag === t ? 'tag-pill--active' : ''}`}
                    onClick={() => { setView('bookmarks'); setActiveTag(activeTag === t ? null : t); }}
                  >
                    <IconTag size={10} /> {t}
                  </button>
                ))}
                {allTags.length > 8 && (
                  <button
                    className="tag-pill tag-pill--more"
                    onClick={() => setTagsExpanded((v) => !v)}
                    aria-expanded={tagsExpanded}
                  >
                    {tagsExpanded ? '收起' : `+${allTags.length - 8}`}
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整侧栏宽度"
          title="拖动调整侧栏宽度"
          onMouseDown={startSidebarResize}
          onDoubleClick={() => {
            setSidebarWidth(0);
            localStorage.removeItem('mn:sidebarWidth');
          }}
        />

        <main className="content">
          <div className="content__bar">
            <div className="content__title">
              <h1 title={activeGroupPath.length ? activeGroupPath.map((p) => p.name).join(' / ') : undefined}>
                {view === 'tabs'
                  ? '当前标签页'
                  : activeTag
                    ? `# ${activeTag}`
                    : activeGroup === 'all'
                      ? '全部书签'
                      : activeGroup === 'ungrouped'
                        ? '未分组'
                        : activeGroup === 'recent'
                          ? '最近访问'
                          : activeGroup === 'recent-added'
                            ? '最近添加'
                            : activeGroup === 'read-later'
                              ? '阅读清单'
                              : groupById.get(activeGroup)?.name ?? '书签'}
              </h1>
              <span>
                {view === 'tabs'
                  ? `${tabCount} 个已打开`
                  : activeGroupPath.length > 1
                    ? `${activeGroupPath.map((p) => p.name).join(' / ')} · ${filtered.length} 个书签`
                    : `${filtered.length} 个书签`}
              </span>
            </div>
            {view === 'bookmarks' && isRealGroup(activeGroup) && (
              <button
                className="icon-btn icon-btn--sm"
                onClick={() => setGroupSettingsOpen(true)}
                title={`管理「${groupById.get(activeGroup)?.name}」：改名、颜色、子分组、删除`}
                aria-label={`管理分组 ${groupById.get(activeGroup)?.name ?? ''}`}
              >
                <IconPencil size={14} />
              </button>
            )}
            <div className="content__tools">
              {view === 'bookmarks' && (
                <>
                  {filtered.length > 0 && (
                  <button
                    className={`sort-btn sort-btn--select ${selectMode ? 'is-active' : ''}`}
                    onClick={() => (selectMode ? clearSelection() : setSelectMode(true))}
                    title={selectMode ? '退出多选' : '多选书签（也可按 X 或 ⌘A）'}
                  >
                      {selectMode ? <IconClose size={13} /> : <IconCheck size={13} />}
                      <span className="sort-btn__label">{selectMode ? '退出多选' : '多选'}</span>
                    </button>
                  )}
                  <button
                    className={`sort-btn ${sortAnchor ? 'is-open' : ''}`}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setSortAnchor((cur) => (cur ? null : rect));
                    }}
                    title={`排序：${sortLabels[settings.sort]}（点击选择）`}
                    aria-haspopup="menu"
                    aria-expanded={!!sortAnchor}
                  >
                    <IconSort size={13} />
                    <span className="sort-btn__label">{sortLabels[settings.sort]}</span>
                    <IconChevron size={10} className="sort-btn__caret" />
                  </button>
                  <div className="view-switch" role="group" aria-label="视图模式">
                    <button
                      className={settings.view === 'list' ? 'is-active' : ''}
                      onClick={() => store.setView('list')}
                      aria-label="列表视图"
                    ><IconList size={15} /></button>
                    <button
                      className={settings.view === 'grid' ? 'is-active' : ''}
                      onClick={() => store.setView('grid')}
                      aria-label="网格视图"
                    ><IconGrid size={15} /></button>
                  </div>
                  {(isRealGroup(activeGroup) || activeGroup === 'all' || activeGroup === 'ungrouped') && (
                    <button
                      className="sort-btn sort-btn--icon"
                      onClick={() => handleOpenGroupWindow(activeGroup)}
                      title="在新窗口打开当前列表的全部链接"
                      aria-label="在新窗口打开当前列表的全部链接"
                    >
                      <IconOpenWindow size={13} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {view === 'bookmarks' && selectMode && (
            <div className="bulkbar" role="toolbar" aria-label="批量操作">
              <span className="bulkbar__count">已选 {selectedIds.size}</span>
              <button className="bulkbar__btn" onClick={selectAll}>全选</button>
              <button
                className="bulkbar__btn"
                disabled={selectedIds.size === 0}
                onClick={(e) => setBulkMoveAnchor(e.currentTarget.getBoundingClientRect())}
              >
                <IconMoveTo size={13} /> 移动到…
              </button>
              <button
                className="bulkbar__btn"
                disabled={selectedIds.size === 0}
                onClick={() => setBulkTagOpen((v) => !v)}
              >
                <IconTag size={13} /> 加标签
              </button>
              {bulkTagOpen && (
                <span className="bulkbar__tag">
                  <input
                    autoFocus
                    className="bulkbar__input"
                    value={bulkTag}
                    placeholder="标签名，回车确认"
                    onChange={(e) => setBulkTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleBulkTag(bulkTag); }
                      if (e.key === 'Escape') { setBulkTagOpen(false); setBulkTag(''); }
                    }}
                    aria-label="为选中书签添加的标签"
                  />
                  <button className="bulkbar__btn" onClick={() => handleBulkTag(bulkTag)}>添加</button>
                </span>
              )}
              <button
                className="bulkbar__btn bulkbar__btn--danger"
                disabled={selectedIds.size === 0}
                onClick={handleBulkDelete}
              >
                <IconTrash size={13} /> 删除
              </button>
              <button className="bulkbar__btn bulkbar__btn--ghost" onClick={clearSelection}>取消</button>
            </div>
          )}

          {view === 'tabs' ? (
            <TabsPanel
              bookmarks={bookmarks}
              groups={groups}
              defaultGroupId={isRealGroup(activeGroup) ? activeGroup : null}
              onRequestCreate={requestCreateGroup}
              onAddOne={handleAddFromTab}
              onAddMany={handleAddManyFromTabs}
              onOpenTab={handleOpenTab}
              onCount={setTabCount}
            />
          ) : (
          <div className={`bookmark-list ${settings.view === 'grid' ? 'bookmark-list--grid' : ''}`}>
            {filtered.length === 0 ? (
              <EmptyState
                variant={
                  bookmarks.length === 0
                    ? 'first'
                    : activeGroup === 'read-later' && !query && !activeTag
                      ? 'reading'
                      : activeGroup === 'recent' && !query && !activeTag
                        ? 'recent'
                        : 'filtered'
                }
                onImport={() => void importFromEmptyState()}
                onSaveCurrent={openAddDialog}
                onAdd={openAddDialog}
                onClear={() => { setQuery(''); setActiveGroup('all'); setActiveTag(null); }}
                onBrowseAll={() => { setView('bookmarks'); setActiveGroup('all'); setActiveTag(null); }}
              />
            ) : (
              filtered.map((bm) => (
                <BookmarkRow
                  key={bm.id}
                  bookmark={bm}
                  query={query}
                  group={bm.groupId ? groupById.get(bm.groupId) : undefined}
                  groupPathText={bm.groupId ? groupPathText.get(bm.groupId) : undefined}
                  groups={groups}
                  allBookmarks={bookmarks}
                  view={settings.view}
                  isDragging={dragId.current === bm.id}
                  selectMode={selectMode}
                  selected={selectedIds.has(bm.id)}
                  focused={focusedId === bm.id}
                  onToggleSelect={toggleSelect}
                  onOpen={(b) => store.visitBookmark(b.id, b.url)}
                  onEdit={(b) => setBookmarkDialog({ editing: b })}
                  onMoveToGroup={handleMoveToGroup}
                  onRequestCreateGroup={requestCreateGroup}
                  onDelete={(b) => handleDeleteBookmark(b)}
                  onTogglePin={(b) => store.togglePin(b.id)}
                  onToggleReadLater={(b) => {
                    store.setReadLater(b.id, !b.readLater);
                    showToast(b.readLater ? '已移出阅读清单' : '已加入阅读清单，打开后自动移出');
                  }}
                  onCopyLink={(b) => {
                    void copyText(b.url).then((ok) => {
                      showToast(ok ? '链接已复制' : `复制失败：${b.url}`);
                    });
                  }}
                  onTagClick={(t) => setActiveTag(t)}
                  onDragStart={(id) => { dragId.current = id; setFocusedId(id); }}
                  onDragOver={() => {}}
                  onDrop={(targetId) => {
                    if (dragId.current && dragId.current !== targetId) {
                      store.moveBookmark(dragId.current, targetId, bmGroupForDrop(targetId));
                      showToast('已调整顺序');
                    }
                    dragId.current = null;
                  }}
                  onDragEnd={() => { dragId.current = null; }}
                />
              ))
            )}
          </div>
          )}

          <footer className="bottombar">
            <button className="bottom-btn" onClick={() => setPanel('groups')} title="管理分组">
              <IconFolder size={15} /> <span className="bottom-btn__label">分组</span>
            </button>
            <button className="bottom-btn" onClick={() => setPanel('data')} title="数据与整理">
              <IconArchive size={15} /> <span className="bottom-btn__label">数据</span>
            </button>
            <button className="bottom-btn" onClick={() => setPanel('shortcuts')} title="快捷键">
              <IconKeyboard size={15} /> <span className="bottom-btn__label">快捷键</span>
            </button>
            <span className="bottombar__version">v{store.manifestVersion}</span>
          </footer>
        </main>
      </div>

      {view !== 'tabs' && (
        <button className="fab" onClick={openAddDialog} aria-label="添加书签" title="添加书签（自动填入当前页面）">
          <IconPlus size={22} />
        </button>
      )}

      {/* 弹窗层 */}
      <BookmarkDialog
        open={bookmarkDialog !== null}
        groups={groups}
        editing={bookmarkDialog?.editing ?? null}
        preset={bookmarkDialog?.preset ?? null}
        tagSuggestions={allTags}
        defaultGroupId={isRealGroup(activeGroup) ? activeGroup : null}
        onRequestCreate={requestCreateGroup}
        onClose={() => setBookmarkDialog(null)}
        onSave={handleSaveBookmark}
      />
      <GroupDialog
        open={panel === 'groups'}        groups={groups}
        counts={groupCounts}
        onClose={() => setPanel(null)}
        onRequestCreate={(parentId) => requestCreateGroup(undefined, parentId)}
        onRename={(id, name) => store.updateGroup(id, { name })}
        onRecolor={(id, color) => store.updateGroup(id, { color })}
        onDelete={(id) => {
          const name = groupById.get(id)?.name ?? '分组';
          const snapshot = pushUndo(`删除分组「${name}」`);
          store.deleteGroup(id);
          showUndo(`已删除「${name}」，书签与子分组已上移一级`, () => store.importData(snapshot));
        }}
        onMove={handleMoveGroup}
      />
      <TagDialog
        open={tagPanelOpen}
        tags={tagCounts}
        duplicates={duplicateTags}
        onMerge={(group) => {
          const snapshot = pushUndo(`合并重复标签为「${group.canonical}」`);
          group.members.forEach((m) => {
            if (m.tag !== group.canonical) store.renameTag(m.tag, group.canonical);
          });
          if (activeTag && group.members.some((m) => m.tag === activeTag)) {
            setActiveTag(group.canonical);
          }
          showUndo(`已把 ${group.members.length - 1} 个重复写法合并为「${group.canonical}」`, () => store.importData(snapshot));
        }}
        onClose={() => setTagPanelOpen(false)}
        onRename={(from, to) => {
          const snapshot = pushUndo(`重命名标签「${from}」为「${to}」`);
          store.renameTag(from, to);
          if (activeTag === from) setActiveTag(to.trim());
          showUndo(`已把标签「${from}」改为「${to}」`, () => store.importData(snapshot));
        }}
        onDelete={(tag) => {
          const snapshot = pushUndo(`删除标签「${tag}」`);
          store.deleteTag(tag);
          if (activeTag === tag) setActiveTag(null);
          showUndo(`已删除标签「${tag}」`, () => store.importData(snapshot));
        }}
      />
      {bulkMoveAnchor && (
        <SaveToGroupMenu
          groups={groups}
          bookmarks={bookmarks}
          defaultGroupId={null}
          anchor={bulkMoveAnchor}
          title={`移动 ${selectedIds.size} 个书签到`}
          hierarchical
          onPick={(gid) => {
            setBulkMoveAnchor(null);
            handleBulkMove(gid);
          }}
          onRequestCreate={() => {
            setBulkMoveAnchor(null);
            requestCreateGroup((g) => handleBulkMove(g.id));
          }}
          onClose={() => setBulkMoveAnchor(null)}
        />
      )}
      <DataDialog
        open={panel === 'data'}
        state={store.state}
        duplicates={duplicates}
        onClose={() => setPanel(null)}
        onImportJson={(data: AppState) => store.importData(data)}
        onImportHtml={(items: Bookmark[]) => {
          store.importData({ ...store.state, bookmarks: [...store.state.bookmarks, ...items] });
        }}
        onRemoveDuplicates={(ids) => {
          const idSet = new Set(ids);
          store.importData({
            ...store.state,
            bookmarks: store.state.bookmarks.filter((b) => !idSet.has(b.id)),
          });
          showToast(`已清理 ${ids.length} 个重复书签`);
        }}
        onImportBrowser={handleImportBrowser}
        onDeleteBookmarks={(ids) => {
          const snapshot = pushUndo(`删除 ${ids.length} 个死链书签`);
          store.deleteBookmarks(ids);
          showUndo(`已删除 ${ids.length} 个书签`, () => store.importData(snapshot));
        }}
        onApplyTemplate={(names) => {
          const existing = new Set(store.state.groups.map((g) => g.name));
          const missing = names.filter((n) => !existing.has(n));
          if (!missing.length) return 0;
          pushUndo(`套用分组模板（新建 ${missing.length} 个分组）`);
          const base = store.state.groups.length;
          missing.forEach((name, i) => {
            store.addGroup({ name, color: PALETTE[(base + i) % PALETTE.length] });
          });
          return missing.length;
        }}
      />
      {sortAnchor && (
        <SortMenu
          value={settings.sort}
          anchor={sortAnchor}
          onPick={(mode) => {
            store.setSort(mode);
            setSortAnchor(null);
          }}
          onClose={() => setSortAnchor(null)}
        />
      )}
      <ShortcutsDialog open={panel === 'shortcuts'} onClose={() => setPanel(null)} />
      <GroupSettingsDialog
        group={groupSettingsOpen ? groupById.get(activeGroup) ?? null : null}
        groups={groups}
        count={groupCounts[activeGroup] ?? 0}
        onClose={() => setGroupSettingsOpen(false)}
        onSave={(patch) => {
          const g = groupById.get(activeGroup);
          if (!g) return;
          pushUndo(patch.name ? `重命名分组「${g.name}」` : `更改分组「${g.name}」颜色`);
          store.updateGroup(g.id, patch);
          showToast('分组已更新');
        }}
        onDelete={(id) => {
          const g = groupById.get(id);
          const name = g?.name ?? '分组';
          const snapshot = pushUndo(`删除分组「${name}」`);
          store.deleteGroup(id);
          if (activeGroup === id) setActiveGroup('all');
          showUndo(`已删除「${name}」，书签与子分组已上移一级`, () => store.importData(snapshot));
        }}
        onCreateSub={(parentId) => requestCreateGroup(undefined, parentId)}
        onMove={handleMoveGroup}
      />
      <QuickSwitcher
        open={switcherOpen}
        bookmarks={bookmarks}
        groups={groups}
        commands={switcherCommands}
        onClose={() => setSwitcherOpen(false)}
        onPickBookmark={handleSwitcherBookmark}
        onPickGroup={handleSwitcherGroup}
      />
      <GroupCreateDialog
        open={createGroupOpen}
        parentName={createParentId ? groupById.get(createParentId)?.name ?? null : null}
        onSubmit={handleGroupCreated}
        onClose={() => {
          setCreateGroupOpen(false);
          setCreateParentId(null);
          groupCreatedHandler.current = null;
        }}
      />

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.actionLabel && toast.action && (
            <button
              className="toast__action"
              onClick={() => {
                toast.action?.();
                setToast(null);
                if (toastTimer.current) window.clearTimeout(toastTimer.current);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );

  function bmGroupForDrop(targetId: string): string | null {
    const target = bookmarks.find((b) => b.id === targetId);
    if (!target) return null;
    if (!isRealGroup(activeGroup)) return target.groupId;
    return activeGroup;
  }
}
