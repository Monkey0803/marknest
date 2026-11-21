import { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { flushSync } from 'react-dom';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useBookmarkStore } from './store/useBookmarkStore';
import {
  buildAllSubtrees, buildGroupTree, downloadFile, exportGroupHtml, findDuplicateTags,
  formatCount, getHost, groupPath, groupSubtreeIds, normalizeUrl, sortBookmarks,
} from './lib/utils';
import type { GroupNode } from './lib/utils';
import {
  SHORTCUT_ACTIONS, autoTagsFor, findDuplicateGroups, hasAdvancedSyntax, matchesCombo,
  matchesQuery, matchesSmartFolder, parseSearchQuery, stripTrackingParams, type MatchContext,
} from './lib/features';
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
  IconReadingList, IconPencil, IconLocate, IconThemeAuto, IconTrashBin, IconWand,
  IconSmartFolder, IconChart, IconSliders, IconLock, IconEdit, IconAlert, IconRestore,
} from './components/Icons';
import SortMenu from './components/SortMenu';
import EmptyState from './components/EmptyState';
import ShortcutsDialog from './components/ShortcutsDialog';
import ConfirmDeleteGroupDialog from './components/ConfirmDeleteGroupDialog';
import RecycleBinDialog from './components/RecycleBinDialog';
import SmartFoldersDialog from './components/SmartFoldersDialog';
import InsightsDialog from './components/InsightsDialog';
import BatchEditDialog from './components/BatchEditDialog';
import SettingsDialog from './components/SettingsDialog';
import PinDialog from './components/PinDialog';
import DedupeDialog, { type DedupeOperation } from './components/DedupeDialog';

type Panel = 'bookmarks' | 'groups' | 'data' | 'shortcuts';

/** 虚拟视图 id（侧栏快捷入口，非真实分组） */
const VIRTUAL_VIEWS = new Set(['all', 'ungrouped', 'recent', 'recent-added', 'read-later', 'trash']);

export default function App() {
  const store = useBookmarkStore();
  const isOptions = window.location.pathname.includes('options');

  const [query, setQuery] = useState('');
  /** 搜索词延迟版：输入保持即时响应，较重的过滤/排序用延迟值，千条数据下不卡打字 */
  const deferredQuery = useDeferredValue(query);
  const [activeGroup, setActiveGroup] = useState<string>('all');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [view, setView] = useState<'bookmarks' | 'tabs'>('bookmarks');
  const [tabCount, setTabCount] = useState(0);
  const [panel, setPanel] = useState<Panel | null>(null);
  /** 数据面板打开后是否自动聚焦「书签健康」并检测（死链角标/巡检入口） */
  const [focusHealth, setFocusHealth] = useState(false);
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
  /** 待确认删除的分组 id（删除分组前置提示影响范围） */
  const [pendingDeleteGroupId, setPendingDeleteGroupId] = useState<string | null>(null);
  /** 极窄面板下：侧栏收成抽屉，由顶栏按钮唤出 */
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** 侧栏宽度（可拖拽调节，0 表示用样式默认值） */
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const v = Number(localStorage.getItem('mn:sidebarWidth'));
    return Number.isFinite(v) && v >= 130 ? v : 0;
  });
  /** 「定位当前页面书签」：命中卡片的临时高亮与滚动触发计数 */
  const [locatedId, setLocatedId] = useState<string | null>(null);
  const [locateSeq, setLocateSeq] = useState(0);
  const locateTimer = useRef<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragId = useRef<string | null>(null);
  /** 拖拽高亮用 state 驱动：ref 变化不会触发渲染，拖完会残留高亮 */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /* ---- 新功能：回收站 / 智能文件夹 / 洞察 / 批量编辑 / 设置 / PIN ---- */
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [smartFoldersOpen, setSmartFoldersOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  /** 待解锁的私密分组 id */
  const [pinTarget, setPinTarget] = useState<string | null>(null);
  /** 本次会话已解锁的私密分组（刷新后重新锁定） */
  const [unlockedGroups, setUnlockedGroups] = useState<Set<string>>(new Set());

  const { bookmarks: allBookmarks, groups: allGroups, settings } = store.state;
  /** 常规视图用的书签：排除回收站软删项（回收站视图单独读取 allBookmarks） */
  const bookmarks = useMemo(() => allBookmarks.filter((b) => !b.deletedAt), [allBookmarks]);
  /** 私密分组保护：未解锁的私密分组（及其子树）id 集合，用于隐藏其书签 */
  const lockedGroupIds = useMemo(() => {
    const set = new Set<string>();
    // 未设置 PIN 时不存在可校验的锁，任何残留 private 标记都不应锁定书签
    if (!settings.pinHash) return set;
    for (const g of allGroups) {
      if (!g.private || unlockedGroups.has(g.id)) continue;
      groupSubtreeIds(allGroups, g.id).forEach((id) => set.add(id));
    }
    return set;
  }, [allGroups, unlockedGroups, settings.pinHash]);
  /** 所有面向用户的出口共用的可见书签集合：排除回收站软删项 + 未解锁的私密分组。
   *  主列表、搜索、计数、去重、洞察、QuickSwitcher、导出等一律基于它，避免 PIN 被绕过。 */
  const visibleBookmarks = useMemo(
    () => bookmarks.filter((b) => !b.groupId || !lockedGroupIds.has(b.groupId)),
    [bookmarks, lockedGroupIds],
  );
  const groups = allGroups;
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

  /** 主题三态循环：浅色 → 深色 → 跟随浏览器 → 浅色 */
  const cycleTheme = useCallback(() => {
    const next = settings.theme === 'light' ? 'dark' : settings.theme === 'dark' ? 'system' : 'light';
    storeRef.current.setTheme(next);
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

  /** 带自定义动作的提示（如「恢复我的版本」） */
  const showAction = useCallback((msg: string, label: string, action: () => void) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text: msg, actionLabel: label, action });
    toastTimer.current = window.setTimeout(() => setToast(null), 8000);
  }, []);

  /* ------------------------ 多级撤销 / 重做（⌘Z / ⌘⇧Z） ------------------------ */
  /** 撤销条目带唯一 token：toast 的「撤销」凭 token 精确撤销对应操作，不再盲弹栈顶 */
  interface UndoEntry { state: AppState; label: string; token: number }
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);
  const undoTokenSeq = useRef(0);
  /** 最近一次 pushUndo 的 token，供 showUndo 绑定 */
  const lastUndoToken = useRef<number | null>(null);
  /** 在改动前调用：把当前完整状态压入撤销栈（保留最近 20 步），返回该条目的 token */
  const pushUndo = useCallback((label: string): number => {
    const token = ++undoTokenSeq.current;
    const snapshot = storeRef.current.state;
    undoStack.current = [...undoStack.current, { state: snapshot, label, token }].slice(-20);
    // 一次新改动意味着此前的「重做」分支作废
    redoStack.current = [];
    lastUndoToken.current = token;
    return token;
  }, []);

  /** 精确撤销到某 token：从栈中移除该条及其之后的项（通常就是栈顶），恢复它的前置快照 */
  const undoToToken = useCallback((token: number | null) => {
    if (token === null) return;
    const idx = undoStack.current.findIndex((e) => e.token === token);
    if (idx < 0) {
      showToast('该操作已撤销或已被后续操作覆盖');
      return;
    }
    const entries = undoStack.current.slice(idx); // [目标, ..., 最新]，按时间顺序
    const target = entries[0];
    // 重做栈存「每步撤销前的状态」：从次新往目标方向，每步的撤销前状态就是后一个 entry 的快照。
    // 依次压入 entries[1..n].state，最后压入当前最新状态，pop 时即可逐步回到撤销前。
    const redoAdds: UndoEntry[] = [];
    for (let i = 1; i < entries.length; i += 1) {
      redoAdds.push({ state: entries[i].state, label: entries[i].label, token: entries[i].token });
    }
    redoAdds.push({ state: storeRef.current.state, label: target.label, token: -1 });
    redoStack.current = [...redoStack.current, ...redoAdds].slice(-20);
    undoStack.current = undoStack.current.slice(0, idx);
    storeRef.current.importData(target.state);
    showToast(`已撤销：${target.label}`);
  }, [showToast]);

  /** ⌘Z：撤销栈顶一步 */
  const performUndo = useCallback(() => {
    const last = undoStack.current[undoStack.current.length - 1];
    if (!last) {
      showToast('没有可撤销的操作');
      return;
    }
    undoToToken(last.token);
  }, [showToast, undoToToken]);

  const performRedo = useCallback(() => {
    const last = redoStack.current.pop();
    if (!last) {
      showToast('没有可重做的操作');
      return;
    }
    undoStack.current = [
      ...undoStack.current,
      { state: storeRef.current.state, label: last.label, token: ++undoTokenSeq.current },
    ].slice(-20);
    storeRef.current.importData(last.state);
    showToast(`已重做：${last.label}`);
  }, [showToast]);

  /** 带「撤销」的提示：自动绑定到最近一次 pushUndo 的 token，撤销的一定是这条提示对应的操作 */
  const showUndo = useCallback((msg: string) => {
    const token = lastUndoToken.current;
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text: msg, actionLabel: '撤销', action: () => undoToToken(token) });
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }, [undoToToken]);


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

  /**
   * 一键定位：拿到当前页面（或指定标签行）的网址，在书签库里找对应书签，
   * 清除筛选 → 切到书签所在分组 → 滚动并短暂高亮。未收藏时给一个「去收藏」入口。
   * 网址按协议、尾部斜杠、大小写归一化后比对，避免 http/https 或末尾 / 差异漏匹配。
   */
  const locateBookmark = useCallback((url?: string, title?: string) => {
    /** 完整网址指纹：去 hash、统一协议/域名大小写、去 www 与末尾斜杠，保留 query */
    const urlKey = (value: string) => {
      try {
        const u = new URL(normalizeUrl(value || ''));
        u.hash = '';
        return `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
      } catch {
        return (value || '').split('#')[0].replace(/\/+$/, '').toLowerCase();
      }
    };
    /** 宽松指纹：忽略 query，兼容同页不同参数的收藏记录 */
    const pathKey = (value: string) => {
      try {
        const u = new URL(normalizeUrl(value || ''));
        return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
      } catch {
        return urlKey(value);
      }
    };
    const apply = (raw: string) => {
      const normalized = normalizeUrl(raw || '');
      if (!/^https?:\/\//i.test(normalized)) {
        showToast(/^chrome-extension:/i.test(raw || '')
          ? '当前是扩展页面，请先切换到普通网页标签再定位'
          : '当前页面无法定位（仅支持普通网页）');
        return;
      }
      const all = storeRef.current.state.bookmarks ?? [];
      const targetUrl = urlKey(normalized);
      const targetPath = pathKey(normalized);
      const host = getHost(normalized);
      const sameHost = all.filter((b) => getHost(b.url || '') === host);
      // 脏数据（url 缺失）不能让整个查找抛错；先精确匹配，再退到忽略 query，
      // 最后如果该域名只收藏了一条，认为它就是目标（兼容短链跳转、参数改写等）
      let bm = all.find((b) => urlKey(b.url || '') === targetUrl)
        ?? all.find((b) => pathKey(b.url || '') === targetPath);
      const byHostOnly = !bm && sameHost.length === 1;
      if (byHostOnly) bm = sameHost[0];
      if (!bm) {
        const brief = normalized.replace(/^https?:\/\//i, '').replace(/\/$/, '');
        showAction(
          `未找到「${brief.length > 46 ? `${brief.slice(0, 46)}…` : brief}」${sameHost.length ? `（该域名 ${sameHost.length} 条）` : '（该域名无书签）'}`,
          '去收藏',
          () => {
            if (title) setBookmarkDialog({ editing: null, preset: { url: normalized, title } });
            else openAddDialog();
          },
        );
        return;
      }
      const groupsNow = storeRef.current.state.groups ?? [];
      const inGroup = !!bm.groupId && groupsNow.some((g) => g.id === bm.groupId);
      // flushSync：让筛选、分组、高亮在同一次渲染里落地；
      // 否则 useDeferredValue 会晚一帧更新，滚动回调拿不到刚出现的卡片
      flushSync(() => {
        setSelectMode(false);
        setSelectedIds(new Set());
        setView('bookmarks');
        setActiveGroup(inGroup ? bm.groupId! : 'all');
        setActiveTag(null);
        setQuery('');
        // 关掉可能遮住结果的浮层，确保定位结果立即可见
        setPanel(null);
        setGroupSettingsOpen(false);
        setTagPanelOpen(false);
        setDrawerOpen(false);
        setSwitcherOpen(false);
        setFocusedId(null);
        setLocatedId(bm.id);
        setLocateSeq((n) => n + 1);
      });
      if (locateTimer.current) window.clearTimeout(locateTimer.current);
      locateTimer.current = window.setTimeout(() => setLocatedId(null), 5000);
      const path = inGroup
        ? groupPath(groupsNow, bm.groupId!).map((g) => g.name).join(' / ')
        : '';
      const suffix = byHostOnly ? '（同域名唯一书签，网址不完全一致）' : '';
      showToast(`${path ? `已定位到「${bm.title}」· ${path}` : `已定位到「${bm.title}」· 未分组`}${suffix}`);
    };
    if (url !== undefined) { apply(url); return; }
    const tabsApi = (globalThis as { chrome?: typeof chrome }).chrome?.tabs;
    if (!tabsApi?.query) {
      showToast('当前环境无法读取浏览器标签页');
      return;
    }
    tabsApi.query({ active: true, currentWindow: true })
      .then((list) => {
        try {
          apply(list?.[0]?.url ?? '');
        } catch (err) {
          console.error('locateBookmark failed', err);
          showToast('定位失败，请检查书签数据');
        }
      })
      .catch(() => showToast('读取当前标签页失败，请稍后再试'));
  }, [showToast, showAction, openAddDialog]);

  /* ------------------------ 快速切换面板 ------------------------ */
  const browseTo = useCallback((group: string, tag: string | null = null) => {
    setView('bookmarks');
    setActiveGroup(group);
    setActiveTag(tag);
    setQuery('');
  }, []);

  const switcherCommands = useMemo<SwitcherCommand[]>(() => [
    { id: 'new', label: '新建书签', run: openAddDialog },
    { id: 'locate', label: '定位当前页面在书签中的位置', run: () => locateBookmark() },
    {
      id: 'theme',
      label: settings.theme === 'light' ? '切换到深色主题'
        : settings.theme === 'dark' ? '跟随浏览器主题' : '切换到浅色主题',
      run: cycleTheme,
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
  ], [settings.theme, openAddDialog, locateBookmark, browseTo, cycleTheme]);

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

  /** 分组 → 自身及全部后代 id（一次建图，供计数/筛选/整组操作共用，避免 O(G²)） */
  const subtreeMap = useMemo(() => buildAllSubtrees(groups), [groups]);

  /** 每个分组包含其后代的书签总数（父分组计数覆盖整棵子树） */
  const groupCounts = useMemo(() => {
    const own: Record<string, number> = {};
    visibleBookmarks.forEach((b) => {
      if (b.groupId) own[b.groupId] = (own[b.groupId] ?? 0) + 1;
    });
    const total: Record<string, number> = {};
    subtreeMap.forEach((ids, gid) => {
      let n = 0;
      ids.forEach((id) => { n += own[id] ?? 0; });
      total[gid] = n;
    });
    return total;
  }, [visibleBookmarks, subtreeMap]);

  /** 待删除分组的影响范围（直接 + 间接子分组数、子树内书签数） */
  const pendingDeleteImpact = useMemo(() => {
    if (!pendingDeleteGroupId) return { childGroups: 0, bookmarkCount: 0 };
    const ids = groupSubtreeIds(groups, pendingDeleteGroupId);
    return {
      childGroups: Math.max(0, ids.size - 1),
      bookmarkCount: bookmarks.filter((b) => b.groupId && ids.has(b.groupId)).length,
    };
  }, [pendingDeleteGroupId, groups, bookmarks]);

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
    visibleBookmarks.forEach((b) => b.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return Array.from(m.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
  }, [visibleBookmarks]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    visibleBookmarks.forEach((b) => b.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [visibleBookmarks]);

  /** 智能去重：按 URL 指纹归组（忽略协议/www/追踪参数/hash 等），每组推荐信息最完整的保留项 */
  const duplicateGroups = useMemo(() => findDuplicateGroups(visibleBookmarks), [visibleBookmarks]);
  /** DataDialog 兼容用的冗余 id 列表（保留每组推荐项，其余为冗余） */
  const duplicates = useMemo(
    () => duplicateGroups.flatMap((g) => g.members.slice(1).map((m) => m.bookmark.id)),
    [duplicateGroups],
  );

  /** 阅读清单未读数量（侧栏角标） */
  const unreadCount = useMemo(
    () => visibleBookmarks.filter((b) => b.readLater).length,
    [visibleBookmarks],
  );

  /** 语义重复的标签组（仅大小写/全半角/空白差异） */
  const duplicateTags = useMemo(
    () => findDuplicateTags(visibleBookmarks),
    [visibleBookmarks],
  );

  /** 回收站数量 */
  const trashCount = useMemo(() => allBookmarks.filter((b) => b.deletedAt).length, [allBookmarks]);

  /** 归档（下沉本地）数量 */
  const archivedCount = useMemo(() => allBookmarks.filter((b) => b.archived).length, [allBookmarks]);

  /** 智能文件夹命中数 */
  const smartFolderCounts = useMemo(() => {
    const ctx: MatchContext = { groupPathText };
    const out: Record<string, number> = {};
    settings.smartFolders.forEach((f) => {
      out[f.id] = visibleBookmarks.filter((b) => matchesSmartFolder(b, f, ctx)).length;
    });
    return out;
  }, [settings.smartFolders, visibleBookmarks, groupPathText]);

  /** 死链角标数量（排除软删与未解锁私密分组） */
  const deadLinkCount = settings.healthMonitor.deadIds.filter((id) => visibleBookmarks.some((b) => b.id === id)).length;

  /** 键盘监听用 ref 读取最新列表，避免每次筛选变化都重绑 window 监听 */
  const filteredRef = useRef<Bookmark[]>([]);

  const filtered = useMemo(() => {
    // 回收站视图：直接返回软删项，不走常规筛选
    if (activeGroup === 'trash' && view === 'bookmarks') {
      return allBookmarks
        .filter((b) => b.deletedAt)
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
    }
    const q = deferredQuery.trim().toLowerCase();
    const advanced = hasAdvancedSyntax(q);
    const parsed = advanced ? parseSearchQuery(q) : null;
    const matchCtx: MatchContext = { groupPathText };
    // 选择智能文件夹时，用其保存的 query 作为额外过滤
    const smart = settings.smartFolders.find((f) => f.id === activeGroup);
    const smartQuery = smart ? parseSearchQuery(smart.query) : null;
    const subtree = !VIRTUAL_VIEWS.has(activeGroup) && !smart
      ? subtreeMap.get(activeGroup) ?? null
      : null;
    // visibleBookmarks 已排除软删项与未解锁的私密分组，所有常规视图共用
    let items = visibleBookmarks.filter((b) => {
      if (activeGroup === 'ungrouped' && b.groupId) return false;
      if (subtree) {
        // 选中父分组时，同时展示所有嵌套子分组里的书签
        if (!b.groupId || !subtree.has(b.groupId)) return false;
      }
      if (activeTag && !b.tags.includes(activeTag)) return false;
      if (smartQuery && !matchesQuery(b, smartQuery, matchCtx)) return false;
      if (q) {
        if (parsed && advanced) {
          if (!matchesQuery(b, parsed, matchCtx)) return false;
        } else {
          const hay = `${b.title} ${b.url} ${getHost(b.url)} ${b.description} ${b.tags.join(' ')} ${
            b.groupId ? groupPathText.get(b.groupId) ?? '' : ''
          }`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
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
  }, [bookmarks, allBookmarks, deferredQuery, activeGroup, activeTag, settings.sort, settings.smartFolders, subtreeMap, groupPathText, lockedGroupIds, view]);
  filteredRef.current = filtered;

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
      // 自定义快捷键：读取设置里的绑定，缺省回退到内置默认值
      const bindings = storeRef.current.state.settings.shortcuts ?? {};
      const hit = (id: string) => {
        const def = SHORTCUT_ACTIONS.find((a) => a.id === id)?.default;
        return matchesCombo(e, bindings[id] ?? def);
      };
      // 快速切换面板打开时，键盘事件全部交给面板自身处理
      if (switcherOpen) return;
      // 模态弹窗打开时，全局快捷键一律不响应：它们由各自的 useModalFocus 处理 Esc/Tab，
      // 快捷键设置页录制组合键时若冒泡到这里，会误触发快速切换/搜索等动作。
      // Escape 交给弹窗自身；这里只拦截快捷键类事件。
      const anyModalOpen = settingsOpen || recycleOpen || smartFoldersOpen || insightsOpen
        || dedupeOpen || batchEditOpen || pinTarget !== null;
      if (anyModalOpen && e.key !== 'Escape') return;
      if (hit('command')) {
        e.preventDefault();
        setSwitcherOpen(true);
        return;
      }
      if (!typing && hit('locate')) {
        e.preventDefault();
        locateBookmark();
        return;
      }
      if (!typing && !panel && view === 'bookmarks' && hit('selectAll')) {
        e.preventDefault();
        selectAll();
        return;
      }
      if (!typing && hit('search')) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      // 与其它快捷键一致：输入态 / 弹窗打开时不响应，避免在弹窗里叠加新建弹窗
      const anyDialogOpen = !!panel || createGroupOpen || !!bookmarkDialog
        || groupSettingsOpen || !!pendingDeleteGroupId || tagPanelOpen || bulkTagOpen;
      if (!typing && !anyDialogOpen && hit('new')) {
        e.preventDefault();
        openAddDialog();
        return;
      }
      // 多级撤销 / 重做（输入框内的文本撤销交给原生行为）
      if (!typing && !panel && view === 'bookmarks') {
        if (hit('undo')) {
          e.preventDefault();
          performUndo();
          return;
        }
        if (hit('redo') || (mod && e.key.toLowerCase() === 'y')) {
          e.preventDefault();
          performRedo();
          return;
        }
      }
      // 列表键盘导航（仅书签视图、非输入态、无弹窗时）；列表从 ref 读，避免重绑监听
      const rows = filteredRef.current;
      if (!typing && !panel && view === 'bookmarks' && rows.length > 0) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const dir = e.key === 'ArrowDown' ? 1 : -1;
          const idx = rows.findIndex((b) => b.id === focusedId);
          const nextIdx = idx < 0
            ? (dir === 1 ? 0 : rows.length - 1)
            : Math.min(rows.length - 1, Math.max(0, idx + dir));
          setFocusedId(rows[nextIdx].id);
          return;
        }
        if (e.key === 'Enter' && focusedId) {
          const bm = rows.find((b) => b.id === focusedId);
          if (bm) {
            e.preventDefault();
            storeRef.current.visitBookmark(bm.id, bm.url);
            return;
          }
        }
        if (hit('select')) {
          const bm = rows.find((b) => b.id === focusedId) ?? rows[0];
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
  }, [panel, query, activeTag, focusedId, selectMode, selectAll, clearSelection, toggleSelect, view,
    openAddDialog, locateBookmark, performUndo, performRedo, switcherOpen,
    createGroupOpen, bookmarkDialog, groupSettingsOpen, pendingDeleteGroupId, tagPanelOpen, bulkTagOpen,
    settingsOpen, recycleOpen, smartFoldersOpen, insightsOpen, dedupeOpen, batchEditOpen, pinTarget]);

  // 键盘焦点 / 定位命中的卡片滚到列表中央。列表受 useDeferredValue 影响可能晚一帧才刷新，
  // 因此逐帧重试直到卡片出现；直接设置滚动容器位置，不依赖浏览器对 scrollIntoView 的行为差异。
  useEffect(() => {
    const id = locatedId ?? focusedId;
    if (!id) return;
    let frame = 0;
    let tries = 0;
    const center = () => {
      const el = document.querySelector<HTMLElement>(`[data-bm-id="${id}"]`);
      if (!el) {
        if (tries++ < 40) frame = requestAnimationFrame(center);
        return;
      }
      const container = el.closest<HTMLElement>('.bookmark-list');
      if (container) {
        const offset = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
        const top = container.scrollTop + offset - (container.clientHeight - el.clientHeight) / 2;
        container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      } else {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    frame = requestAnimationFrame(center);
    return () => cancelAnimationFrame(frame);
  }, [focusedId, locatedId, locateSeq]);

  // 卸载时清理定时器，避免延时回调在组件销毁后仍触发 setState
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    if (locateTimer.current) window.clearTimeout(locateTimer.current);
  }, []);

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

  // 死链巡检定时器到点：提示用户执行检测（真正检测在前端进行）
  // 监听 local 变化而非只在挂载时读一次，避免面板常开时 alarm 到点的提示被漏掉。
  const healthDueShown = useRef(0);
  useEffect(() => {
    if (!store.ready) return;
    let alive = true;
    const dueAt = (value: unknown) => Number(value) || 0;
    const fireIfDue = (value: unknown) => {
      const ts = dueAt(value);
      if (!alive || !ts || ts <= healthDueShown.current) return;
      healthDueShown.current = ts;
      chrome.storage.local.remove('mn:health-due').catch(() => {});
      showAction('死链巡检时间到了', '立即检测', () => {
        setFocusHealth(true);
        setPanel('data');
      });
    };
    // 挂载时补读一次（覆盖面板关闭期间 alarm 已写入的情况）
    chrome.storage.local.get('mn:health-due').then((obj) => fireIfDue(obj['mn:health-due'])).catch(() => {});
    // storage.local.onChanged 只回传 changes（area 恒为 local，无需判断）
    const onChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes['mn:health-due']) fireIfDue(changes['mn:health-due'].newValue);
    };
    chrome.storage.local.onChanged.addListener(onChange);
    return () => { alive = false; chrome.storage.local.onChanged.removeListener(onChange); };
  }, [store.ready, showAction]);

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
    // 先采样「移动前」快照：moveGroup 内部会同步提交 stateRef，
    // 若在其后才 pushUndo，采样到的就是移动后状态，撤销会失效。
    const token = pushUndo(parentId ? `移动分组「${name}」` : `把「${name}」移回顶层`);
    const ok = store.moveGroup(id, parentId);
    if (!ok) {
      // 未实际移动：回滚这次压栈，避免留下一步空撤销
      undoStack.current = undoStack.current.filter((e) => e.token !== token);
      lastUndoToken.current = undoStack.current[undoStack.current.length - 1]?.token ?? null;
      showToast('不能把分组移动到它自己或它的子分组里');
      return;
    }
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

  /** 确认删除分组：统计子树影响后交给确认弹窗，真正确认后才落库 */
  const requestDeleteGroup = (id: string) => setPendingDeleteGroupId(id);

  const confirmDeleteGroup = () => {
    const id = pendingDeleteGroupId;
    if (!id) return;
    const name = groupById.get(id)?.name ?? '分组';
    pushUndo(`删除分组「${name}」`);
    store.deleteGroup(id);
    if (activeGroup === id) setActiveGroup('all');
    if (groupSettingsOpen) setGroupSettingsOpen(false);
    setPendingDeleteGroupId(null);
    showUndo(`已删除「${name}」，书签与子分组已上移一级`);
  };

  /* ------------------------ 批量操作 ------------------------ */
  const handleBulkMove = (groupId: string | null) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const name = groupId === null ? '未分组' : groupById.get(groupId)?.name ?? '分组';
    pushUndo(`移动 ${ids.length} 个书签到「${name}」`);
    store.moveBookmarksToGroup(ids, groupId);
    clearSelection();
    showUndo(`已将 ${ids.length} 个书签移动到「${name}」`);
  };

  const handleBulkTag = (tag: string) => {
    const t = tag.trim();
    if (!t || selectedIds.size === 0) return;
    pushUndo(`给 ${selectedIds.size} 个书签加标签「${t}」`);
    store.addTagToBookmarks(Array.from(selectedIds), t);
    setBulkTag('');
    setBulkTagOpen(false);
    showUndo(`已给 ${selectedIds.size} 个书签加上「${t}」`);
  };

  const handleDeleteBookmark = (bm: Bookmark, label?: string) => {
    pushUndo(`删除「${bm.title}」`);
    store.deleteBookmark(bm.id);
    showUndo(label ?? `已把「${bm.title}」移入回收站`);
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    pushUndo(`删除 ${ids.length} 个书签`);
    store.deleteBookmarks(ids);
    clearSelection();
    showUndo(`已把 ${ids.length} 个书签移入回收站`);
  };

  /* ------------------------ 回收站 ------------------------ */
  const handleRestore = (ids: string[]) => {
    if (!ids.length) return;
    pushUndo(`还原 ${ids.length} 个书签`);
    store.restoreBookmarks(ids);
    showUndo(`已还原 ${ids.length} 个书签`);
  };
  const handlePurge = (ids: string[]) => {
    if (!ids.length) return;
    pushUndo(`彻底删除 ${ids.length} 个书签`);
    store.purgeBookmarks(ids);
    showUndo(`已彻底删除 ${ids.length} 个书签`);
  };
  const handleEmptyTrash = () => {
    pushUndo('清空回收站');
    store.emptyTrash();
    showUndo('回收站已清空');
  };

  /* ------------------------ 批量编辑 ------------------------ */
  const handleBatchEdit = () => {
    if (selectedIds.size === 0) return;
    setBatchEditOpen(true);
  };
  const applyBatchDesc = (value: string) => {
    pushUndo(`批量改备注（${selectedIds.size} 个）`);
    store.bulkSetDescription(Array.from(selectedIds), value);
    clearSelection();
    showUndo(`已修改 ${selectedIds.size} 个书签的备注`);
  };
  const applyBatchUrl = (from: string, to: string) => {
    pushUndo(`批量替换网址（${selectedIds.size} 个）`);
    store.bulkReplaceUrl(Array.from(selectedIds), from, to);
    clearSelection();
    showUndo(`已替换 ${selectedIds.size} 个书签的网址前缀`);
  };
  const applyBatchRename = (find: string, replace: string, prefix: string, suffix: string) => {
    pushUndo(`批量重命名（${selectedIds.size} 个）`);
    store.bulkRename(Array.from(selectedIds), find, replace, prefix, suffix);
    clearSelection();
    showUndo(`已重命名 ${selectedIds.size} 个书签`);
  };

  /* ------------------------ 智能去重 ------------------------ */
  /**
   * 一次性提交所有合并操作：保留项吸收元数据（标签并集/备注/访问数/置顶），
   * 冗余项软删进回收站。单次 importData 保证撤销栈只有一步、多端同步一次完成。
   */
  const handleApplyDedupe = (operations: DedupeOperation[]) => {
    if (!operations.length) return;
    const keepPatches = new Map<string, Partial<Bookmark>>();
    const removeIds = new Set<string>();
    let removed = 0;
    for (const op of operations) {
      keepPatches.set(op.keepId, op.patch);
      op.removeIds.forEach((id) => removeIds.add(id));
      removed += op.removeIds.length;
    }
    pushUndo(`智能去重（合并 ${removed} 条，${operations.length} 组）`);
    store.importData({
      ...storeRef.current.state,
      bookmarks: storeRef.current.state.bookmarks.map((b) => {
        if (keepPatches.has(b.id)) return { ...b, ...keepPatches.get(b.id)! };
        if (removeIds.has(b.id)) return { ...b, deletedAt: b.deletedAt ?? Date.now(), updatedAt: Date.now() };
        return b;
      }),
    });
    showUndo(`已合并 ${removed} 条重复书签（${operations.length} 组），可撤销或从回收站还原`);
  };

  /* ------------------------ 智能文件夹 / 设置 / 洞察 ------------------------ */
  const handleSaveSmartFolders = (folders: typeof settings.smartFolders) => {
    pushUndo('修改智能文件夹');
    store.setSetting('smartFolders', folders);
    showUndo('智能文件夹已更新');
  };
  const handleSettingsPatch = (patch: Partial<typeof settings>) => {
    (Object.keys(patch) as (keyof typeof settings)[]).forEach((key) => {
      // 逐个写入，沿用 setSetting 的持久化与去重逻辑
      store.setSetting(key, patch[key] as never);
    });
  };
  const handleRunArchive = (days: number) => {
    const n = store.archiveColdBookmarks(days);
    showToast(n ? `已归档 ${n} 个冷书签（local 留副本，跨设备仍可见）` : '没有符合条件的冷书签');
  };
  const handleUnarchiveAll = () => {
    const n = store.unarchiveAll();
    showToast(n ? `已取回 ${n} 个归档书签` : '没有归档书签');
  };
  const handleRunHealthCheck = () => {
    // 复用角标/定时提醒的同一路径：打开数据面板健康区，自动检测并展示可逐条删除的结果列表
    setSettingsOpen(false);
    setFocusHealth(true);
    setPanel('data');
  };
  const handleSetPin = (hash: string | undefined) => {
    pushUndo('修改 PIN');
    // 原子更新：清除 PIN 时由 store 一并抹掉分组的 private 标记，避免分组仍被锁定却无法校验
    store.setPin(hash);
    // 只要 PIN 发生变更（设置/修改/清除），已解锁会话一律失效
    setUnlockedGroups(new Set());
    showUndo(hash ? 'PIN 已设置' : 'PIN 已取消');
  };

  /** 点击分组：若受 PIN 保护且未解锁，先弹 PIN 对话框 */
  const selectGroup = (gid: string) => {
    if (lockedGroupIds.has(gid)) {
      setPinTarget(gid);
      return;
    }
    setView('bookmarks');
    setActiveGroup(gid);
    setActiveTag(null);
  };

  const handleShareGroup = (gid: string) => {
    // 分享给他人时排除所有私密分组（含子树），无论当前是否已解锁——私密内容不外泄
    const excluded = new Set<string>();
    for (const g of allGroups) {
      if (g.private) groupSubtreeIds(allGroups, g.id).forEach((id) => excluded.add(id));
    }
    const html = exportGroupHtml(gid, allBookmarks, groups, excluded);
    const name = groupById.get(gid)?.name ?? '分组';
    downloadFile(html, `marknest-share-${name}.html`, 'text/html;charset=utf-8');
    showToast('已导出只读分享页 HTML（已排除私密分组）');
  };

  /* ------------------------ 侧栏宽度拖拽 ------------------------ */
  const startSidebarResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const aside = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
    const startX = e.clientX;
    const startW = aside?.getBoundingClientRect().width ?? 150;
    let latest = startW;
    const onMove = (ev: MouseEvent) => {
      const max = Math.max(200, Math.min(360, window.innerWidth - 260));
      latest = Math.round(Math.min(max, Math.max(130, startW + ev.clientX - startX)));
      setSidebarWidth(latest);
      // 只在拖动结束时落盘：mousemove 每次写 localStorage 是同步 I/O，会拖慢拖拽
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('is-resizing');
      localStorage.setItem('mn:sidebarWidth', String(latest));
    };
    document.body.classList.add('is-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** 在新浏览器窗口打开指定分组下的所有书签链接（含嵌套子分组） */
  const handleOpenGroupWindow = (groupId: string | null) => {
    // 锁定分组（或其祖先）未解锁时，禁止批量打开，避免绕过 PIN 泄露网址
    if (groupId && groupId !== 'all' && groupId !== 'ungrouped' && lockedGroupIds.has(groupId)) {
      showToast('请先解锁该私密分组');
      return;
    }
    const ids = groupId && groupId !== 'all' && groupId !== 'ungrouped'
      ? subtreeMap.get(groupId) ?? new Set([groupId])
      : null;
    const urls = visibleBookmarks
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

  /** 供设置页配置文件夹映射：提取浏览器书签树里的文件夹节点（无 url 即文件夹） */
  const loadBrowserFolders = useCallback(async (): Promise<{ id: string; title: string }[]> => {
    const tree = await readBrowserBookmarks();
    const out: { id: string; title: string }[] = [];
    const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[], depth: number) => {
      for (const node of nodes) {
        if (node.url) continue;
        out.push({ id: node.id, title: `${'　'.repeat(Math.min(depth, 6))}${node.title || '未命名文件夹'}` });
        if (node.children) walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, []);

  /**
   * 从 Chrome 导入：把书签文件夹树映射为分组树（支持嵌套），网址去重。
   * 同名同层分组会复用已存在的分组，重复导入不会堆出多套树。
   */
  const handleImportBrowser = async () => {
    // 先等书签树读完，再基于「此刻」的最新内存态重算去重集合与分组池。
    // 若用调用时刻闭包里的旧快照，await 期间收到的远端同步会被整份覆盖（P0 数据丢失）。
    const tree = await readBrowserBookmarks();
    const latest = storeRef.current.state;
    const existing = new Set(latest.bookmarks.map((b) => b.url.replace(/\/+$/, '')));
    const knownBrowserIds = new Set(latest.bookmarks.map((b) => b.browserId).filter(Boolean));
    const now = Date.now();
    const newGroups: Group[] = [];
    const newItems: Bookmark[] = [];
    let imported = 0;
    let skipped = 0;
    let unsupported = 0;

    const keyOf = (parentId: string | null, name: string) => `${parentId ?? 'root'}|${name}`;
    const pool = new Map<string, string>();
    latest.groups.forEach((g) => pool.set(keyOf(g.parentId, g.name), g.id));
    /** 浏览器文件夹 id → 扩展分组 id（供增量同步识别同源书签） */
    const browserFolderMap: Record<string, string> = { ...latest.settings.browserSync.folderMap };

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
          // 已按 browserId 同步过，或网址重复：跳过
          if (knownBrowserIds.has(node.id) || existing.has(norm)) {
            skipped += 1;
            continue;
          }
          existing.add(norm);
          knownBrowserIds.add(node.id);
          const cleanUrl = latest.settings.stripTracking ? stripTrackingParams(node.url) : node.url;
          const title = node.title || getHost(node.url);
          // 自动打标签：与标签页收藏/右键收藏口径一致
          const tags = autoTagsFor(latest.settings.autoTagRules, { tags: [], url: cleanUrl, title });
          newItems.push({
            id: crypto.randomUUID(),
            title,
            url: cleanUrl,
            description: '',
            groupId: parentGroupId,
            tags,
            favicon: '',
            createdAt: now + imported,
            updatedAt: now + imported,
            visitedAt: 0,
            visits: 0,
            pinned: false,
            order: now + imported,
            browserId: node.id,
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
        browserFolderMap[node.id] = gid;
        if (node.children) walk(node.children, gid);
      }
    };

    tree.forEach((root) => walk(root.children ?? [], null));

    if (newItems.length || newGroups.length) {
      // 再次从 storeRef 取最新态：walk 是同步的但 handleImportBrowser 是异步入口，
      // 用调用者的旧闭包会丢掉期间到达的任何改动。
      const base = storeRef.current.state;
      store.importData({
        ...base,
        groups: [...base.groups, ...newGroups],
        bookmarks: [...base.bookmarks, ...newItems],
        settings: {
          ...base.settings,
          browserSync: { ...base.settings.browserSync, folderMap: browserFolderMap, lastSyncedAt: Date.now() },
        },
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
          {deadLinkCount > 0 && (
            <button
              className="icon-btn topbar__alert"
              onClick={() => { setFocusHealth(true); setPanel('data'); }}
              title={`检测到 ${deadLinkCount} 个死链`}
              aria-label={`检测到 ${deadLinkCount} 个死链`}
            >
              <IconAlert size={17} />
              <span className="topbar__badge">{deadLinkCount > 99 ? '99+' : deadLinkCount}</span>
            </button>
          )}
          <button
            className="icon-btn"
            onClick={() => locateBookmark()}
            title="定位当前页面在书签中的位置（⌘/Ctrl+⇧+L）"
            aria-label="定位当前页面书签"
          >
            <IconLocate size={17} />
          </button>
          <button
            className="icon-btn"
            onClick={cycleTheme}
            title={settings.theme === 'light' ? '主题：浅色 · 点击切换深色'
              : settings.theme === 'dark' ? '主题：深色 · 点击跟随浏览器' : '主题：跟随浏览器 · 点击切换浅色'}
            aria-label="切换主题"
          >
            {settings.theme === 'light' ? <IconSun size={17} />
              : settings.theme === 'dark' ? <IconMoon size={17} />
                : <IconThemeAuto size={17} />}
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) {
              const q = query.trim();
              const recent = [q, ...settings.searchHistory.map((h) => h.query).filter((x) => x !== q)].slice(0, 20);
              store.setSetting('searchHistory', recent.map((text, i) => ({ query: text, at: i === 0 ? Date.now() : settings.searchHistory.find((h) => h.query === text)?.at ?? Date.now() })));
            }
          }}
          placeholder="搜索标题、网址、标签或备注…（支持 tag: domain: group: 未读）"
          aria-label="搜索书签"
        />
        {query ? (
          <button className="icon-btn icon-btn--sm" onClick={() => setQuery('')} aria-label="清除搜索">
            <IconClose size={15} />
          </button>
        ) : (
          <kbd className="kbd">/</kbd>
        )}
        {!query && settings.searchHistory.length > 0 && (
          <div className="search-history">
            <span>最近搜索：</span>
            {settings.searchHistory.slice(0, 6).map((h) => (
              <button key={h.query} className="chip" onClick={() => setQuery(h.query)} title={new Date(h.at).toLocaleString('zh-CN')}>
                {h.query}
              </button>
            ))}
            <button className="search-history__clear" onClick={() => store.setSetting('searchHistory', [])}>清除</button>
          </div>
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
              <em>{formatCount(tabCount)}</em>
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
              <em>{formatCount(unreadCount)}</em>
            </button>
            <button
              className={`nav-item ${view === 'bookmarks' && activeGroup === 'trash' ? 'nav-item--active' : ''}`}
              onClick={() => { setView('bookmarks'); setActiveGroup('trash'); setActiveTag(null); setQuery(''); }}
              title="已删除的书签，可还原或彻底清除"
            >
              <IconTrashBin size={15} />
              <span>回收站</span>
              <em>{formatCount(trashCount)}</em>
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
                <em>{formatCount(bookmarks.length)}</em>
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
                <em>{formatCount(bookmarks.filter((b) => !b.groupId).length)}</em>
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
                    onClick={() => selectGroup(g.id)}
                    title={depth ? groupPath(groups, g.id).map((p) => p.name).join(' / ') : g.name}
                  >
                    {lockedGroupIds.has(g.id) ? (
                      <IconLock size={14} style={{ color: g.color, flexShrink: 0 }} />
                    ) : (
                      <IconFolder size={15} style={{ color: g.color, flexShrink: 0 }} />
                    )}
                    <span className="nav-item__name">{g.name}</span>
                    <em>{formatCount(groupCounts[g.id] ?? 0)}</em>
                  </button>
                  {!lockedGroupIds.has(g.id) && (
                    <button
                      className="nav-group__open"
                      onClick={() => handleOpenGroupWindow(g.id)}
                      title={`在新窗口打开「${g.name}」的所有标签`}
                      aria-label={`在新窗口打开「${g.name}」的所有标签`}
                    >
                      <IconOpenWindow size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {settings.smartFolders.length > 0 && (
            <div className="sidebar__section">
              <div className="sidebar__label-row">
                <p className="sidebar__label">智能文件夹</p>
                <button
                  className="sidebar__add sidebar__add--text"
                  onClick={() => setSmartFoldersOpen(true)}
                  title="管理智能文件夹"
                  aria-label="管理智能文件夹"
                >
                  <IconWand size={11} />
                  <span>管理</span>
                </button>
              </div>
              {settings.smartFolders.map((f) => (
                <button
                  key={f.id}
                  className={`nav-item ${view === 'bookmarks' && activeGroup === f.id ? 'nav-item--active' : ''}`}
                  onClick={() => { setView('bookmarks'); setActiveGroup(f.id); setActiveTag(null); }}
                  title={`智能查询：${f.query}`}
                >
                  <IconSmartFolder size={15} style={{ color: f.color, flexShrink: 0 }} />
                  <span className="nav-item__name">{f.name}</span>
                  <em>{formatCount(smartFolderCounts[f.id] ?? 0)}</em>
                </button>
              ))}
            </div>
          )}

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
                              : activeGroup === 'trash'
                                ? '回收站'
                                : settings.smartFolders.find((f) => f.id === activeGroup)?.name
                                  ?? groupById.get(activeGroup)?.name ?? '书签'}
              </h1>
              <span>
                {view === 'tabs'
                  ? `${tabCount} 个已打开`
                  : activeGroup === 'recent'
                    ? `仅统计在 Marknest 内打开 · ${filtered.length} 个`
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
              <button
                className="bulkbar__btn"
                disabled={selectedIds.size === 0}
                onClick={handleBatchEdit}
                title="批量改备注 / 替换网址 / 重命名"
              >
                <IconEdit size={13} /> 编辑
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
              bookmarks={visibleBookmarks}
              groups={groups}
              defaultGroupId={isRealGroup(activeGroup) ? activeGroup : null}
              onRequestCreate={requestCreateGroup}
              onAddOne={handleAddFromTab}
              onAddMany={handleAddManyFromTabs}
              onOpenTab={handleOpenTab}
              onLocate={(url, title) => locateBookmark(url, title)}
              onCount={setTabCount}
            />
          ) : activeGroup === 'trash' ? (
            <div className="bookmark-list">
              <div className="trash-toolbar">
                <span>回收站中有 {filtered.length} 个书签</span>
                <button
                  className="btn btn--danger btn--sm"
                  disabled={filtered.length === 0}
                  onClick={handleEmptyTrash}
                >
                  <IconTrashBin size={13} /> 清空回收站
                </button>
              </div>
              {filtered.length === 0 ? (
                <p className="trash-empty">回收站是空的。删除的书签会先放到这里，可随时还原。</p>
              ) : filtered.map((bm) => (
                <div key={bm.id} className="trash-row">
                  <div className="trash-row__body">
                    <strong>{bm.title}</strong>
                    <span>{bm.url}</span>
                    <small>删除于 {new Date(bm.deletedAt ?? 0).toLocaleString('zh-CN')}</small>
                  </div>
                  <button className="btn btn--ghost btn--sm" onClick={() => handleRestore([bm.id])}>
                    <IconRestore size={13} /> 还原
                  </button>
                  <button className="btn btn--danger btn--sm" onClick={() => handlePurge([bm.id])}>
                    彻底删除
                  </button>
                </div>
              ))}
            </div>
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
                  query={deferredQuery}
                  group={bm.groupId ? groupById.get(bm.groupId) : undefined}
                  groupPathText={bm.groupId ? groupPathText.get(bm.groupId) : undefined}
                  groups={groups}
                  allBookmarks={visibleBookmarks}
                  view={settings.view}
                  isDragging={draggingId === bm.id}
                  selectMode={selectMode}
                  selected={selectedIds.has(bm.id)}
                  focused={focusedId === bm.id}
                  located={locatedId === bm.id}
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
                  onDragStart={(id) => { dragId.current = id; setDraggingId(id); setFocusedId(id); }}
                  onDragOver={() => {}}
                  onDrop={(targetId) => {
                    if (dragId.current && dragId.current !== targetId) {
                      pushUndo('调整书签顺序');
                      store.moveBookmark(dragId.current, targetId, bmGroupForDrop(targetId));
                      showToast('已调整顺序（可撤销）');
                    }
                    dragId.current = null;
                    setDraggingId(null);
                  }}
                  onDragEnd={() => { dragId.current = null; setDraggingId(null); }}
                />
              ))
            )}
          </div>
          )}

          <footer className="bottombar">
            <button className="bottom-btn" onClick={() => setPanel('groups')} title="管理分组">
              <IconFolder size={15} /> <span className="bottom-btn__label">分组</span>
            </button>
            <button className="bottom-btn" onClick={() => setSettingsOpen(true)} title="设置：自动标签、浏览器同步、死链巡检、分层存储、快捷键、私密">
              <IconSliders size={15} /> <span className="bottom-btn__label">设置</span>
            </button>
            <button className="bottom-btn" onClick={() => setInsightsOpen(true)} title="数据洞察">
              <IconChart size={15} /> <span className="bottom-btn__label">洞察</span>
            </button>
            <button className="bottom-btn" onClick={() => setRecycleOpen(true)} title="回收站">
              <IconTrashBin size={15} /> <span className="bottom-btn__label">回收站</span>
              {trashCount > 0 && <em className="bottom-btn__badge">{formatCount(trashCount)}</em>}
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
        onDelete={requestDeleteGroup}
        onMove={handleMoveGroup}
      />
      <TagDialog
        open={tagPanelOpen}
        tags={tagCounts}
        duplicates={duplicateTags}
        onMerge={(group) => {
          pushUndo(`合并重复标签为「${group.canonical}」`);
          group.members.forEach((m) => {
            if (m.tag !== group.canonical) store.renameTag(m.tag, group.canonical);
          });
          if (activeTag && group.members.some((m) => m.tag === activeTag)) {
            setActiveTag(group.canonical);
          }
          showUndo(`已把 ${group.members.length - 1} 个重复写法合并为「${group.canonical}」`);
        }}
        onClose={() => setTagPanelOpen(false)}
        onRename={(from, to) => {
          pushUndo(`重命名标签「${from}」为「${to}」`);
          store.renameTag(from, to);
          if (activeTag === from) setActiveTag(to.trim());
          showUndo(`已把标签「${from}」改为「${to}」`);
        }}
        onDelete={(tag) => {
          pushUndo(`删除标签「${tag}」`);
          store.deleteTag(tag);
          if (activeTag === tag) setActiveTag(null);
          showUndo(`已删除标签「${tag}」`);
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
        visibleBookmarks={visibleBookmarks}
        duplicates={duplicates}
        duplicateGroupCount={duplicateGroups.length}
        onOpenDedupe={() => { setPanel(null); setDedupeOpen(true); }}
        focusHealth={focusHealth}
        onClose={() => { setPanel(null); setFocusHealth(false); }}
        onHealthResult={(deadIds) => {
          store.setSetting('healthMonitor', { ...settings.healthMonitor, lastRunAt: Date.now(), deadIds });
        }}
        onImportJson={(data: AppState) => {
          pushUndo('导入 JSON（覆盖）');
          store.importData(data);
          showUndo('已导入 JSON，原数据可撤销恢复');
        }}
        onImportHtml={(items: Bookmark[]) => {
          pushUndo(`导入 HTML（新增 ${items.length} 条）`);
          store.importData({ ...store.state, bookmarks: [...store.state.bookmarks, ...items] });
          showToast(`已导入 ${items.length} 个书签，可撤销`);
        }}
        onImportBrowser={handleImportBrowser}
        onDeleteBookmarks={(ids) => {
          pushUndo(`删除 ${ids.length} 个死链书签`);
          store.deleteBookmarks(ids);
          showUndo(`已删除 ${ids.length} 个书签`);
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
      <ShortcutsDialog
        open={panel === 'shortcuts'}
        onClose={() => setPanel(null)}
        bindings={settings.shortcuts}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <GroupSettingsDialog
        group={groupSettingsOpen ? groupById.get(activeGroup) ?? null : null}
        groups={groups}
        count={groupCounts[activeGroup] ?? 0}
        onClose={() => setGroupSettingsOpen(false)}
        onSave={(patch) => {
          const g = groupById.get(activeGroup);
          if (!g) return;
          pushUndo(`更新分组「${g.name}」设置`);
          store.updateGroup(g.id, patch);
          showToast(patch.private !== undefined ? (patch.private ? '已设为私密分组' : '已取消私密') : '分组已更新');
        }}
        onDelete={requestDeleteGroup}
        onCreateSub={(parentId) => requestCreateGroup(undefined, parentId)}
        onMove={handleMoveGroup}
        hasPin={Boolean(settings.pinHash)}
        onShare={handleShareGroup}
      />
      <QuickSwitcher
        open={switcherOpen}
        bookmarks={visibleBookmarks}
        groups={groups}
        commands={switcherCommands}
        onClose={() => setSwitcherOpen(false)}
        onPickBookmark={handleSwitcherBookmark}
        onPickGroup={handleSwitcherGroup}
      />
      <ConfirmDeleteGroupDialog
        open={pendingDeleteGroupId !== null}
        name={pendingDeleteGroupId ? groupById.get(pendingDeleteGroupId)?.name ?? '分组' : ''}
        childGroups={pendingDeleteImpact.childGroups}
        bookmarkCount={pendingDeleteImpact.bookmarkCount}
        onConfirm={confirmDeleteGroup}
        onClose={() => setPendingDeleteGroupId(null)}
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

      {/* 新功能弹窗 */}
      <RecycleBinDialog
        open={recycleOpen}
        bookmarks={allBookmarks}
        onClose={() => setRecycleOpen(false)}
        onRestore={handleRestore}
        onPurge={handlePurge}
        onEmpty={handleEmptyTrash}
      />
      <SmartFoldersDialog
        open={smartFoldersOpen}
        folders={settings.smartFolders}
        counts={smartFolderCounts}
        onClose={() => setSmartFoldersOpen(false)}
        onSave={handleSaveSmartFolders}
      />
      <InsightsDialog open={insightsOpen} bookmarks={visibleBookmarks} onClose={() => setInsightsOpen(false)} />
      <DedupeDialog
        open={dedupeOpen}
        bookmarks={visibleBookmarks}
        groups={allGroups}
        onClose={() => setDedupeOpen(false)}
        onApply={handleApplyDedupe}
      />
      <BatchEditDialog
        open={batchEditOpen}
        count={selectedIds.size}
        onClose={() => setBatchEditOpen(false)}
        onSetDescription={applyBatchDesc}
        onReplaceUrl={applyBatchUrl}
        onRename={applyBatchRename}
      />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        groups={allGroups}
        archivedCount={archivedCount}
        onClose={() => setSettingsOpen(false)}
        onPatch={handleSettingsPatch}
        onRunArchive={handleRunArchive}
        onUnarchiveAll={handleUnarchiveAll}
        onRunHealthCheck={handleRunHealthCheck}
        onSetPin={handleSetPin}
        onLoadBrowserFolders={loadBrowserFolders}
      />
      <PinDialog
        open={pinTarget !== null}
        hash={settings.pinHash}
        groupName={pinTarget ? groupById.get(pinTarget)?.name ?? '分组' : ''}
        onClose={() => setPinTarget(null)}
        onUnlocked={() => {
          // 单一 PIN：解锁后本会话内所有私密分组均可查看
          setUnlockedGroups(new Set(allGroups.filter((g) => g.private).map((g) => g.id)));
          setPinTarget(null);
        }}
      />

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.actionLabel && toast.action && (
            <button
              className="toast__action"
              onClick={() => {
                setToast(null);
                if (toastTimer.current) window.clearTimeout(toastTimer.current);
                // 先清当前 toast，再执行动作：撤销动作内部会 showToast「已撤销…」，
                // 若顺序相反，新提示会被上面的 setToast(null) 一并抹掉。
                toast.action?.();
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
