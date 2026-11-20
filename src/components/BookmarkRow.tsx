import React from 'react';
import type { Bookmark, Group } from '../types';
import {
  colorFromString, faviconCandidates, getHost, highlightSegments, relativeTime, rememberFavicon,
} from '../lib/utils';
import {
  IconExternal, IconPin, IconPencil, IconTrash, IconTag, IconDots, IconMoveTo, IconCheck, IconCopy,
  IconReadingList,
} from './Icons';
import SaveToGroupMenu from './SaveToGroupMenu';

interface Props {
  bookmark: Bookmark;
  group?: Group;
  /** 分组完整层级路径，用于 chip 的 tooltip（同名子分组可区分） */
  groupPathText?: string;
  groups: Group[];
  allBookmarks: Bookmark[];
  view: 'grid' | 'list';
  highlighted?: boolean;
  /** 当前搜索关键词，用于在标题/域名/备注里高亮命中片段 */
  query?: string;
  /** 多选模式：卡片左侧出现勾选圈，点击卡片不再直接打开 */
  selectMode?: boolean;
  selected?: boolean;
  /** 键盘导航的当前焦点卡片 */
  focused?: boolean;
  /** 「定位当前页面书签」命中后的临时高亮 */
  located?: boolean;
  onToggleSelect?: (bm: Bookmark) => void;
  onOpen: (bm: Bookmark) => void;
  onEdit: (bm: Bookmark) => void;
  onDelete: (bm: Bookmark) => void;
  onTogglePin: (bm: Bookmark) => void;
  onToggleReadLater: (bm: Bookmark) => void;
  onCopyLink: (bm: Bookmark) => void;
  onMoveToGroup: (id: string, groupId: string | null) => void;
  onRequestCreateGroup: (onDone: (group: Group) => void) => void;
  onTagClick: (tag: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDrop: (id: string) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

/** 按 query 命中位置渲染文本，命中片段加 <mark> 高亮 */
function Hl({ text, query }: { text: string; query?: string }) {
  if (!query || !query.trim()) return <>{text}</>;
  const segs = highlightSegments(text, query);
  return (
    <>
      {segs.map((s, i) => (s.hit ? <mark key={i} className="bm__hl">{s.text}</mark> : <React.Fragment key={i}>{s.text}</React.Fragment>))}
    </>
  );
}

function Favicon({ bm }: { bm: Bookmark }) {
  // 依次尝试候选图标地址；首字母色块始终垫底，图标加载成功后才淡入覆盖，
  // 切换候选时不会再出现空白/破图闪烁。key 绑定 url 以便切换书签时重置状态
  const candidates = React.useMemo(() => faviconCandidates(bm), [bm.url, bm.favicon]);
  const [idx, setIdx] = React.useState(0);
  const [loadedSrc, setLoadedSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    setIdx(0);
    setLoadedSrc(null);
  }, [bm.url, bm.favicon]);

  const color = colorFromString(getHost(bm.url));
  const letter = (bm.title || getHost(bm.url)).charAt(0).toUpperCase();
  const src = idx < candidates.length ? candidates[idx] : null;

  return (
    <span className="bm-favicon-wrap">
      <span className="bm-favicon bm-favicon--fallback" style={{ background: color }} aria-hidden>
        {letter}
      </span>
      {src && (
        <img
          key={`${bm.id}-${idx}`}
          src={src}
          className={`bm-favicon bm-favicon--remote ${loadedSrc === src ? 'is-loaded' : ''}`}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => {
            rememberFavicon(bm.url, src);
            setLoadedSrc(src);
          }}
          onError={() => setIdx((i) => i + 1)}
          referrerPolicy="no-referrer"
        />
      )}
    </span>
  );
}

export default function BookmarkRow({
  bookmark: bm, group, groupPathText, groups, allBookmarks, view, highlighted, query,
  selectMode, selected, focused, located, onToggleSelect, onOpen, onEdit, onDelete,
  onTogglePin, onToggleReadLater, onCopyLink, onMoveToGroup, onRequestCreateGroup, onTagClick,
  onDragStart, onDragOver, onDrop, onDragEnd, isDragging,
}: Props) {
  const [tagsExpanded, setTagsExpanded] = React.useState(false);
  const [moveAnchor, setMoveAnchor] = React.useState<DOMRect | null>(null);
  const COLLAPSED_TAGS = 3;
  const hiddenTags = bm.tags.slice(COLLAPSED_TAGS);
  const visibleTags = tagsExpanded || hiddenTags.length === 0 ? bm.tags : bm.tags.slice(0, COLLAPSED_TAGS);
  return (
    <article
      data-bm-id={bm.id}
      className={`bm bm--${view} ${isDragging ? 'bm--dragging' : ''} ${highlighted ? 'bm--hl' : ''} ${bm.pinned ? 'bm--pinned' : ''} ${selected ? 'bm--selected' : ''} ${focused ? 'bm--focused' : ''} ${located ? 'bm--located' : ''} ${selectMode ? 'bm--select' : ''}`}
      draggable={!selectMode}
      aria-selected={selected || undefined}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(bm.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(bm.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(bm.id);
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if (!selectMode) return;
        // 多选模式下整卡点击即切换勾选，避免误打开
        if ((e.target as HTMLElement).closest('button, a, input')) return;
        onToggleSelect?.(bm);
      }}
    >
      {selectMode && (
        <button
          className={`bm__check ${selected ? 'is-checked' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(bm); }}
          aria-pressed={!!selected}
          aria-label={selected ? `取消选择 ${bm.title}` : `选择 ${bm.title}`}
        >
          {selected && <IconCheck size={11} />}
        </button>
      )}
      <div
        className="bm__main"
        role="link"
        tabIndex={selectMode ? -1 : 0}
        aria-label={`打开书签 ${bm.title}`}
        onClick={() => { if (!selectMode) onOpen(bm); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !selectMode) onOpen(bm);
        }}
      >
        <Favicon bm={bm} />
        <div className="bm__info">
          <div className="bm__title-row">
            <span className="bm__title" title={bm.title}><Hl text={bm.title} query={query} /></span>
            {bm.pinned && <IconPin size={12} className="bm__pin-mark" />}
            {bm.readLater && <span className="bm__pin-mark" title="稍后阅读"><IconReadingList size={12} /></span>}
          </div>
          <span className="bm__url"><Hl text={getHost(bm.url)} query={query} /></span>
          {bm.description && <p className="bm__desc"><Hl text={bm.description} query={query} /></p>}
          <div className="bm__meta">
            {group && (
              <span
                className="bm__group"
                style={{ color: group.color }}
                title={groupPathText ? `分组：${groupPathText}` : `分组：${group.name}`}
              >
                <span className="bm__group-dot" style={{ background: group.color }} />
                {group.name}
              </span>
            )}
            {visibleTags.map((t) => (
              <button
                key={t}
                className="bm__tag"
                onClick={(e) => { e.stopPropagation(); onTagClick(t); }}
                title={`筛选标签 ${t}`}
              >
                <IconTag size={10} /> {t}
              </button>
            ))}
            {hiddenTags.length > 0 && (
              <button
                className={`bm__tag bm__tag--more ${tagsExpanded ? 'is-expanded' : ''}`}
                onClick={(e) => { e.stopPropagation(); setTagsExpanded((v) => !v); }}
                title={tagsExpanded ? '收起标签' : `还有 ${hiddenTags.length} 个标签：${hiddenTags.join('、')}`}
                aria-expanded={tagsExpanded}
              >
                {tagsExpanded ? '收起' : `+${hiddenTags.length}`}
              </button>
            )}
            {bm.visits > 0 && (
              <span className="bm__visits" title={`在 Marknest 中打开过 ${bm.visits} 次`}>
                {bm.visits} 次访问
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="bm__actions">
        <button
          className={`icon-btn icon-btn--sm ${bm.pinned ? 'is-active' : ''}`}
          onClick={() => onTogglePin(bm)}
          title={bm.pinned ? '取消置顶' : '置顶'}
          aria-label={bm.pinned ? '取消置顶' : '置顶'}
        >
          <IconPin size={14} />
        </button>
        <button
          className={`icon-btn icon-btn--sm ${bm.readLater ? 'is-active' : ''}`}
          onClick={() => onToggleReadLater(bm)}
          title={bm.readLater ? '移出阅读清单（标记已读）' : '加入阅读清单（稍后阅读）'}
          aria-label={bm.readLater ? `把 ${bm.title} 移出阅读清单` : `把 ${bm.title} 加入阅读清单`}
        >
          <IconReadingList size={14} />
        </button>
        <button
          className="icon-btn icon-btn--sm"
          onClick={(e) => setMoveAnchor(e.currentTarget.getBoundingClientRect())}
          title="移动到分组"
          aria-label={`移动「${bm.title}」到其他分组`}
        >
          <IconMoveTo size={14} />
        </button>
        <button
          className="icon-btn icon-btn--sm"
          onClick={() => onCopyLink(bm)}
          title="复制链接"
          aria-label={`复制「${bm.title}」的链接`}
        >
          <IconCopy size={14} />
        </button>
        <button
          className="icon-btn icon-btn--sm"
          onClick={() => onEdit(bm)}
          title="编辑"
          aria-label={`编辑 ${bm.title}`}
        >
          <IconPencil size={14} />
        </button>
        <button
          className="icon-btn icon-btn--sm icon-btn--danger"
          onClick={() => onDelete(bm)}
          title="删除"
          aria-label={`删除 ${bm.title}`}
        >
          <IconTrash size={14} />
        </button>
        <span className="bm__drag" title="拖动排序"><IconDots size={14} /></span>
      </div>

      <button
        className="bm__goto"
        onClick={() => onOpen(bm)}
        title="在新标签页打开"
        aria-label={`在新标签页打开 ${bm.title}`}
      >
        <IconExternal size={14} />
      </button>
      <span className="bm__updated" title="最后更新于">{relativeTime(bm.updatedAt)}</span>

      {moveAnchor && (
        <SaveToGroupMenu
          groups={groups}
          bookmarks={allBookmarks}
          defaultGroupId={bm.groupId}
          anchor={moveAnchor}
          title="移动到分组"
          hierarchical
          onPick={(gid) => {
            setMoveAnchor(null);
            onMoveToGroup(bm.id, gid);
          }}
          onRequestCreate={() => {
            onRequestCreateGroup((g) => onMoveToGroup(bm.id, g.id));
          }}
          onClose={() => setMoveAnchor(null)}
        />
      )}
    </article>
  );
}
