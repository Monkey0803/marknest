import { useRef, useState } from 'react';
import type { Bookmark } from '../types';
import { relativeTime } from '../lib/utils';
import { useModalFocus } from '../lib/useModalFocus';
import { IconClose, IconRestore, IconTrash, IconSearch } from './Icons';

interface Props {
  open: boolean;
  bookmarks: Bookmark[];
  onClose: () => void;
  onRestore: (ids: string[]) => void;
  onPurge: (ids: string[]) => void;
  onEmpty: () => void;
}

export default function RecycleBinDialog({ open, bookmarks, onClose, onRestore, onPurge, onEmpty }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef, onClose);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');

  if (!open) return null;
  const trashed = bookmarks
    .filter((b) => b.deletedAt)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  const shown = q.trim()
    ? trashed.filter((b) => `${b.title} ${b.url}`.toLowerCase().includes(q.trim().toLowerCase()))
    : trashed;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const doRestore = () => {
    onRestore(Array.from(selected));
    setSelected(new Set());
  };
  const doPurge = () => {
    onPurge(Array.from(selected));
    setSelected(new Set());
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={modalRef}
        tabIndex={-1}
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="回收站"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="modal__title">回收站 <span className="modal__count">{trashed.length}</span></h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal__body">
          <p className="hint">删除的书签先进入回收站，可随时还原。彻底删除后不可恢复。</p>
          <div className="rb-toolbar">
            <div className="rb-search">
              <IconSearch size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索回收站…" aria-label="搜索回收站" />
            </div>
            <div className="rb-actions">
              <button className="btn btn--ghost btn--sm" disabled={selected.size === 0} onClick={doRestore}>
                <IconRestore size={13} /> 还原所选
              </button>
              <button className="btn btn--danger btn--sm" disabled={selected.size === 0} onClick={doPurge}>
                <IconTrash size={13} /> 彻底删除
              </button>
              <button className="btn btn--ghost btn--sm" disabled={trashed.length === 0} onClick={() => {
                if (window.confirm(`确定清空回收站吗？将永久删除 ${trashed.length} 个书签，不可恢复。`)) onEmpty();
              }}>
                清空
              </button>
            </div>
          </div>
          <div className="rb-list">
            {shown.length === 0 ? (
              <p className="rb-empty">{trashed.length === 0 ? '回收站是空的' : '没有匹配的书签'}</p>
            ) : shown.map((b) => (
              <label key={b.id} className="rb-row">
                <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggle(b.id)} />
                <div className="rb-row__body">
                  <strong>{b.title}</strong>
                  <span className="rb-row__url">{b.url}</span>
                  <small>删除于 {relativeTime(b.deletedAt ?? 0)}</small>
                </div>
                <div className="rb-row__ops">
                  <button className="icon-btn icon-btn--sm" title="还原" aria-label="还原" onClick={(e) => { e.preventDefault(); onRestore([b.id]); }}>
                    <IconRestore size={14} />
                  </button>
                  <button className="icon-btn icon-btn--sm" title="彻底删除" aria-label="彻底删除" onClick={(e) => { e.preventDefault(); onPurge([b.id]); }}>
                    <IconTrash size={14} />
                  </button>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
