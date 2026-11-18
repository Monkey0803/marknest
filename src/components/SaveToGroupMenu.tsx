import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Group } from '../types';
import { buildGroupTree, flattenGroupTree } from '../lib/utils';
import { IconCheck, IconClose, IconPlus, IconFolder } from './Icons';

interface Props {
  groups: Group[];
  bookmarks: { groupId: string | null }[];
  /** 当前默认分组（顶部标题下高亮的值） */
  defaultGroupId: string | null;
  /** 触发按钮的位置，用于把菜单定位到其旁边 */
  anchor: DOMRect;
  /** 选中分组（含 null 未分组）后回调，由父级完成收藏/移动 */
  onPick: (groupId: string | null) => void;
  /** 请求新建分组：由 App 打开统一对话框，后续动作由父级带上下文处理 */
  onRequestCreate: () => void;
  onClose: () => void;
  /** 菜单标题，默认「收藏到分组」；移动场景可传「移动到分组」 */
  title?: string;
  /** 第一项（值为 null）的文案，默认「未分组」 */
  nullLabel?: string;
  /** 是否显示各分组书签数，默认显示 */
  showCounts?: boolean;
  /** 是否提供「新建分组」入口，默认提供 */
  showCreate?: boolean;
  /** 需要从列表里排除的分组（如移动分组时排除自身与后代） */
  excludeIds?: Set<string>;
  /** 按层级缩进显示 */
  hierarchical?: boolean;
}

const MENU_W = 228;

/**
 * 「+」收藏按钮的分组选择弹出菜单。
 * 用 portal 渲染到 body，避免被 .tabs-list 的 overflow 裁切。
 */
export default function SaveToGroupMenu({
  groups, bookmarks, defaultGroupId, anchor, onPick, onRequestCreate, onClose,
  title = '收藏到分组',
  nullLabel = '未分组',
  showCounts = true,
  showCreate = true,
  excludeIds,
  hierarchical = false,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });

  // 层级模式：按树顺序平铺并记录缩进；否则保持传入顺序
  const rows: { group: Group; depth: number }[] = hierarchical
    ? flattenGroupTree(buildGroupTree(groups)).map((n) => ({ group: n.group, depth: n.depth }))
    : groups.map((group) => ({ group, depth: 0 }));
  const visible = rows.filter((r) => !excludeIds?.has(r.group.id));

  // 定位：优先放按钮下方左侧对齐；空间不足时上移/左移
  useLayoutEffect(() => {
    const margin = 8;
    let left = anchor.left;
    if (left + MENU_W > window.innerWidth - margin) {
      left = window.innerWidth - MENU_W - margin;
    }
    left = Math.max(margin, left);
    let top = anchor.bottom + 4;
    const estimatedH = Math.min(360, 96 + visible.length * 34);
    if (top + estimatedH > window.innerHeight - margin) {
      const above = anchor.top - estimatedH - 4;
      top = above > margin ? above : Math.max(margin, window.innerHeight - estimatedH - margin);
    }
    setPos({ top, left });
  }, [anchor, visible.length]);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // 延迟注册，避免本次点击的冒泡立刻关闭
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const counts = useRef<Record<string, number>>({});
  counts.current = {};
  bookmarks.forEach((b) => {
    if (b.groupId) counts.current[b.groupId] = (counts.current[b.groupId] ?? 0) + 1;
  });

  // 层级模式：按树顺序平铺并记录缩进；否则保持传入顺序
  const pick = (id: string | null) => onPick(id);

  return createPortal(
    <div
      ref={menuRef}
      className="save-menu"
      role="dialog"
      aria-label={title}
      style={{ top: pos.top, left: pos.left, visibility: pos.top < 0 ? 'hidden' : 'visible' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="save-menu__head">
        <span>{title}</span>
        <button className="icon-btn icon-btn--sm" onClick={onClose} aria-label="关闭菜单">
          <IconClose size={13} />
        </button>
      </div>

      <div className="save-menu__list">
        <button
          className={`save-menu__item ${defaultGroupId === null ? 'is-selected' : ''}`}
          onClick={() => pick(null)}
        >
          <IconFolder size={14} className="save-menu__item-icon" />
          <span>{nullLabel}</span>
          {defaultGroupId === null && <IconCheck size={13} className="save-menu__check" />}
        </button>
        {visible.map(({ group: g, depth }) => (
          <button
            key={g.id}
            className={`save-menu__item ${defaultGroupId === g.id ? 'is-selected' : ''}`}
            style={depth ? { paddingLeft: 10 + depth * 14 } : undefined}
            onClick={() => pick(g.id)}
          >
            <span className="nav-item__dot" style={{ background: g.color }} />
            <span className="save-menu__item-name">{g.name}</span>
            {showCounts && <em className="save-menu__count">{counts.current[g.id] ?? 0}</em>}
            {defaultGroupId === g.id && <IconCheck size={13} className="save-menu__check" />}
          </button>
        ))}
      </div>
      {showCreate && (
        <button
          className="save-menu__new"
          onClick={() => {
            onClose();
            onRequestCreate();
          }}
        >
          <IconPlus size={14} /> 新建分组…
        </button>
      )}
    </div>,
    document.body,
  );
}
