import React from 'react';
import type { Bookmark, Group } from '../types';
import { getHost, groupPath } from '../lib/utils';
import { useModalFocus } from '../lib/useModalFocus';
import { IconSearch, IconBookmark, IconFolder, IconTabs, IconClose } from './Icons';

export interface SwitcherCommand {
  id: string;
  label: string;
  run: () => void;
}

interface Props {
  open: boolean;
  bookmarks: Bookmark[];
  groups: Group[];
  commands: SwitcherCommand[];
  onClose: () => void;
  onPickBookmark: (bm: Bookmark) => void;
  onPickGroup: (g: Group) => void;
}

type Row =
  | { kind: 'cmd'; id: string; label: string; run: () => void }
  | { kind: 'group'; id: string; group: Group; pathText: string }
  | { kind: 'bm'; id: string; bm: Bookmark };

/**
 * Quick Switcher：⌘K 唤出，一个输入框同时搜索
 * 命令 / 分组 / 书签，↑↓ 选择、Enter 执行、Esc 关闭。
 */
export default function QuickSwitcher({
  open, bookmarks, groups, commands, onClose, onPickBookmark, onPickGroup,
}: Props) {
  const [q, setQ] = React.useState('');
  const [idx, setIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const modalRef = React.useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef, onClose);

  React.useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      // 等弹窗真正挂载后再聚焦
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const { rows, totalMatches } = React.useMemo(() => {
    const query = q.trim().toLowerCase();
    const match = (text: string) => !query || text.toLowerCase().includes(query);
    const out: Row[] = [];
    let total = 0;
    commands.forEach((c) => {
      if (match(c.label)) { out.push({ kind: 'cmd', id: `c-${c.id}`, label: c.label, run: c.run }); total += 1; }
    });
    groups.forEach((g) => {
      if (match(g.name)) {
        out.push({
          kind: 'group',
          id: `g-${g.id}`,
          group: g,
          pathText: groupPath(groups, g.id).map((p) => p.name).join(' / '),
        });
        total += 1;
      }
    });
    for (const bm of bookmarks) {
      if (match(`${bm.title} ${bm.url}`)) {
        total += 1;
        // 列表最多展示 10 条书签，但 totalMatches 反映真实命中数
        if (out.filter((r) => r.kind === 'bm').length < 10) {
          out.push({ kind: 'bm', id: `b-${bm.id}`, bm });
        }
      }
    }
    return { rows: out.slice(0, 14), totalMatches: total };
  }, [q, commands, groups, bookmarks]);

  // 输入变化后光标回到第一项；结果数量变化（如零结果）时把索引夹回合法范围
  React.useEffect(() => setIdx(0), [q]);
  React.useEffect(() => {
    setIdx((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  // 当前选中项滚入可视区
  React.useEffect(() => {
    listRef.current
      ?.querySelectorAll('[data-row-idx]')
      [idx]?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  if (!open) return null;

  const runRow = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    if (row.kind === 'cmd') row.run();
    else if (row.kind === 'group') onPickGroup(row.group);
    else onPickBookmark(row.bm);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={modalRef}
        tabIndex={-1}
        className="modal modal--switcher"
        role="dialog"
        aria-modal="true"
        aria-label="快速切换"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // 绑在容器上：焦点在输入框或结果行时都能用方向键/回车
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIdx((i) => (rows.length ? Math.min(rows.length - 1, i + 1) : 0));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIdx((i) => (rows.length ? Math.max(0, i - 1) : 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            runRow(rows[idx]);
          }
        }}
      >
        <div className="modal__head modal__head--flush">
          <IconSearch size={16} className="switcher__icon" />
          <input
            ref={inputRef}
            className="switcher__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索书签、分组或命令…"
            aria-label="搜索书签、分组或命令"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="icon-btn icon-btn--sm" onClick={onClose} aria-label="关闭">
            <IconClose size={15} />
          </button>
        </div>
        <div className="switcher__list" ref={listRef}>
          {rows.length === 0 ? (
            <p className="switcher__empty">没有匹配项</p>
          ) : (
            rows.map((row, i) => (
              <button
                key={row.id}
                data-row-idx={i}
                className={`switcher__row ${i === idx ? 'is-active' : ''}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => runRow(row)}
              >
                {row.kind === 'cmd' && (
                  <>
                    <span className="switcher__kind"><IconTabs size={13} /></span>
                    <span className="switcher__label">{row.label}</span>
                    <span className="switcher__hint">命令</span>
                  </>
                )}
                {row.kind === 'group' && (
                  <>
                    <span className="switcher__kind"><IconFolder size={13} style={{ color: row.group.color }} /></span>
                    <span className="switcher__label">{row.group.name}</span>
                    <span className="switcher__hint">{row.pathText}</span>
                  </>
                )}
                {row.kind === 'bm' && (
                  <>
                    <span className="switcher__kind"><IconBookmark size={13} /></span>
                    <span className="switcher__label">{row.bm.title}</span>
                    <span className="switcher__hint">{getHost(row.bm.url)}</span>
                  </>
                )}
              </button>
            ))
          )}
          {totalMatches > rows.length && (
            <p className="switcher__more">
              还有 {totalMatches - rows.length} 条结果未显示，输入更多关键词缩小范围
            </p>
          )}
        </div>
        <div className="switcher__foot">
          <span><kbd className="kbd">↑↓</kbd> 选择</span>
          <span><kbd className="kbd">Enter</kbd> 打开</span>
          <span><kbd className="kbd">Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  );
}
