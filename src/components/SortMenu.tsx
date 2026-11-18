import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SortMode } from '../types';
import { IconCheck } from './Icons';

interface Props {
  value: SortMode;
  anchor: DOMRect;
  onPick: (mode: SortMode) => void;
  onClose: () => void;
}

const OPTIONS: { value: SortMode; label: string; hint: string }[] = [
  { value: 'manual', label: '自定义', hint: '按拖拽顺序' },
  { value: 'recent', label: '最近更新', hint: '刚加的在前' },
  { value: 'title', label: '标题', hint: 'A → Z' },
  { value: 'visits', label: '访问次数', hint: '常用的在前' },
];

const MENU_W = 176;

/** 排序下拉菜单：直接选，而不是点击循环切换 */
export default function SortMenu({ value, anchor, onPick, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    const margin = 8;
    let left = anchor.right - MENU_W;
    left = Math.max(margin, Math.min(left, window.innerWidth - MENU_W - margin));
    let top = anchor.bottom + 4;
    const estimatedH = 40 + OPTIONS.length * 38;
    if (top + estimatedH > window.innerHeight - margin) {
      top = Math.max(margin, anchor.top - estimatedH - 4);
    }
    setPos({ top, left });
  }, [anchor]);

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

  return createPortal(
    <div
      ref={menuRef}
      className="save-menu save-menu--sort"
      role="dialog"
      aria-label="排序方式"
      style={{ top: pos.top, left: pos.left, visibility: pos.top < 0 ? 'hidden' : 'visible' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="save-menu__head"><span>排序方式</span></div>
      <div className="save-menu__list">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            className={`sort-menu__item ${value === o.value ? 'is-selected' : ''}`}
            onClick={() => onPick(o.value)}
            aria-pressed={value === o.value}
          >
            <span className="sort-menu__label">{o.label}</span>
            <span className="sort-menu__hint">{o.hint}</span>
            {value === o.value && <IconCheck size={13} className="save-menu__check" />}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
