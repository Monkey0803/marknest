import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Bookmark, Group } from '../types';
import { colorFromString, getHost } from '../lib/utils';
import type { NewBookmarkInput } from '../store/useBookmarkStore';
import {
  IconTabs, IconRefresh, IconPlus, IconCheck, IconExternal, IconSearch, IconClose, IconLocate,
} from './Icons';
import GroupPicker from './GroupPicker';
import SaveToGroupMenu from './SaveToGroupMenu';

interface OpenTab {
  id: number;
  title: string;
  url: string;
  favIconUrl: string;
  active: boolean;
  windowId: number;
  favBroken?: boolean;
}

interface Props {
  bookmarks: Bookmark[];
  groups: Group[];
  defaultGroupId?: string | null;
  onRequestCreate: (onDone: (group: Group) => void) => void;
  onAddOne: (input: NewBookmarkInput) => void;
  onAddMany: (inputs: NewBookmarkInput[]) => void;
  onOpenTab: (tabId: number, windowId?: number) => void;
  /** 在书签库中定位指定网址（当前活动标签行提供入口） */
  onLocate?: (url: string, title?: string) => void;
  onCount?: (n: number) => void;
}

const normalize = (url: string) => url.replace(/\/+$/, '').toLowerCase();

function TabFavicon({ tab }: { tab: OpenTab }) {
  const [broken, setBroken] = useState(false);
  const color = colorFromString(getHost(tab.url));
  const letter = (tab.title || getHost(tab.url)).charAt(0).toUpperCase();
  if (tab.favIconUrl && !broken && !tab.favBroken) {
    return <img src={tab.favIconUrl} className="tab-favicon" alt="" onError={() => setBroken(true)} />;
  }
  return (
    <span className="tab-favicon tab-favicon--fallback" style={{ background: color }}>{letter}</span>
  );
}

export default function TabsPanel({
  bookmarks, groups, defaultGroupId = null, onRequestCreate,
  onAddOne, onAddMany, onOpenTab, onLocate, onCount,
}: Props) {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'window'>('all');
  // 收藏目标分组：可在收藏前指定或新建
  const [targetGroupId, setTargetGroupId] = useState<string | null>(defaultGroupId);
  useEffect(() => setTargetGroupId(defaultGroupId), [defaultGroupId]);
  // 行内「+」的分组选择菜单：记录被点击的标签页与按钮位置
  const [menu, setMenu] = useState<{ tab: OpenTab; anchor: DOMRect } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const queryInfo = scope === 'window' ? { currentWindow: true } : {};
      const raw = await chrome.tabs.query(queryInfo);
      const filtered: OpenTab[] = raw
        .filter((t) => t.id != null && /^https?:\/\//i.test(t.url || ''))
        .map((t) => ({
          id: t.id!,
          title: t.title || getHost(t.url || ''),
          url: t.url || '',
          favIconUrl: t.favIconUrl || '',
          active: !!t.active,
          windowId: t.windowId ?? 0,
        }));
      setTabs(filtered);
      onCount?.(filtered.length);
    } catch (err) {
      console.error('tabs.query failed', err);
      setError('无法读取标签页，请确认已授予「标签页」权限');
    } finally {
      setLoading(false);
    }
  }, [scope, onCount]);

  useEffect(() => {
    void load();
  }, [load]);

  // 监听标签页变化（新建/关闭/切换/导航）自动刷新
  useEffect(() => {
    const changed = () => void load();
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => {
      if (info.url || info.title || info.status === 'complete') changed();
    };
    chrome.tabs.onCreated.addListener(changed);
    chrome.tabs.onRemoved.addListener(changed);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onCreated.removeListener(changed);
      chrome.tabs.onRemoved.removeListener(changed);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [load]);

  const existing = useMemo(
    () => new Set(bookmarks.map((b) => normalize(b.url))),
    [bookmarks],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tabs.filter((t) => {
      if (q) {
        const hay = `${t.title} ${t.url} ${getHost(t.url)}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });
  }, [tabs, query]);

  const pending = useMemo(
    () => visible.filter((t) => !existing.has(normalize(t.url))),
    [visible, existing],
  );

  const toInput = useCallback(
    (t: OpenTab): NewBookmarkInput => ({
      title: t.title,
      url: t.url,
      groupId: targetGroupId,
      tags: [],
      favicon: t.favIconUrl,
    }),
    [targetGroupId],
  );

  return (
    <div className="tabs-panel">
      <div className="tabs-toolbar">
        <div className="tabs-scope" role="group" aria-label="标签页范围">
          <button
            className={scope === 'all' ? 'is-active' : ''}
            onClick={() => setScope('all')}
          >全部窗口</button>
          <button
            className={scope === 'window' ? 'is-active' : ''}
            onClick={() => setScope('window')}
          >当前窗口</button>
        </div>
        <button className="icon-btn icon-btn--sm" onClick={() => void load()} title="刷新标签页" aria-label="刷新标签页">
          <IconRefresh size={15} />
        </button>
      </div>

      <div className="tabs-target">
        <span className="tabs-target__label">收藏到</span>
        <GroupPicker
          groups={groups}
          value={targetGroupId}
          onChange={setTargetGroupId}
          onRequestCreate={onRequestCreate}
          compact
        />
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          onClick={() => setTargetGroupId(null)}
          title="改为未分组"
          aria-label="改为未分组"
          style={{ visibility: targetGroupId ? 'visible' : 'hidden' }}
        >
          <IconClose size={13} />
        </button>
      </div>

      <div className="tabs-search">
        <IconSearch size={14} className="tabs-search__icon" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="筛选标签页…"
          aria-label="筛选标签页"
        />
        {query && (
          <button className="icon-btn icon-btn--sm" onClick={() => setQuery('')} aria-label="清除">
            <IconClose size={13} />
          </button>
        )}
      </div>

      {pending.length > 0 && (
        <button
          className="tabs-import-all"
          onClick={() => onAddMany(pending.map(toInput))}
          title={`收藏目标：${targetGroupId ? groups.find((g) => g.id === targetGroupId)?.name ?? '分组' : '未分组'}，可在上方「收藏到」里修改`}
        >
          <IconPlus size={14} />
          一键收藏 {pending.length} 个未收藏的标签页到「
          {targetGroupId ? groups.find((g) => g.id === targetGroupId)?.name ?? '分组' : '未分组'}」
        </button>
      )}

      <div className="tabs-list">
        {loading ? (
          <div className="tabs-state">正在读取浏览器标签页…</div>
        ) : error ? (
          <div className="tabs-state tabs-state--error">{error}</div>
        ) : tabs.length === 0 ? (
          <div className="tabs-empty">
            <IconTabs size={26} />
            <p>没有打开的网页标签页</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="tabs-state">没有匹配的标签页</div>
        ) : (
          visible.map((tab) => {
            const saved = existing.has(normalize(tab.url));
            return (
              <article key={tab.id} className={`tab-row ${tab.active ? 'tab-row--active' : ''}`}>
                <span
                  className="tab-row__main"
                  role="link"
                  tabIndex={0}
                  onClick={() => onOpenTab(tab.id, tab.windowId)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpenTab(tab.id, tab.windowId); }}
                  title="切换到此标签页"
                >
                  <TabFavicon tab={tab} />
                  <span className="tab-row__info">
                    <span className="tab-row__title">
                      {tab.title}
                      {tab.active && <em className="tab-row__live">当前</em>}
                    </span>
                    <span className="tab-row__url">{getHost(tab.url)}</span>
                  </span>
                </span>
                {tab.active && onLocate && (
                  <button
                    className="icon-btn icon-btn--sm tab-row__locate"
                    onClick={(e) => { e.stopPropagation(); onLocate(tab.url, tab.title); }}
                    title="在书签中定位当前页面"
                    aria-label="在书签中定位当前页面"
                  >
                    <IconLocate size={13} />
                  </button>
                )}
                {saved ? (
                  <span className="tab-row__saved" title="已收藏">
                    <IconCheck size={13} /> 已收藏
                  </span>
                ) : (
                  <button
                    className="icon-btn icon-btn--sm tab-row__add"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu({ tab, anchor: e.currentTarget.getBoundingClientRect() });
                    }}
                    title="选择分组并收藏"
                    aria-label={`收藏 ${tab.title} 到分组`}
                  >
                    <IconPlus size={15} />
                  </button>
                )}
                <button
                  className="icon-btn icon-btn--sm tab-row__goto"
                  onClick={() => onOpenTab(tab.id, tab.windowId)}
                  title="切换到此标签页"
                  aria-label={`切换到 ${tab.title}`}
                >
                  <IconExternal size={13} />
                </button>
              </article>
            );
          })
        )}
      </div>

      {menu && (
        <SaveToGroupMenu
          groups={groups}
          bookmarks={bookmarks}
          defaultGroupId={targetGroupId}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onRequestCreate={() => {
            const tab = menu.tab;
            setMenu(null);
            // 新建分组后，把触发菜单的那个标签页收藏进新组
            onRequestCreate((group) => {
              onAddOne({
                title: tab.title,
                url: tab.url,
                groupId: group.id,
                tags: [],
                favicon: tab.favIconUrl,
              });
            });
          }}
          onPick={(groupId) => {
            onAddOne({
              title: menu.tab.title,
              url: menu.tab.url,
              groupId,
              tags: [],
              favicon: menu.tab.favIconUrl,
            });
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}
