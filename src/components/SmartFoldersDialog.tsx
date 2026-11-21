import { useRef, useState } from 'react';
import type { SmartFolder } from '../types';
import { useModalFocus } from '../lib/useModalFocus';
import { uid } from '../lib/utils';
import { IconClose, IconPlus, IconTrash, IconSmartFolder, IconPencil } from './Icons';

interface Props {
  open: boolean;
  folders: SmartFolder[];
  counts: Record<string, number>;
  onClose: () => void;
  onSave: (folders: SmartFolder[]) => void;
}

const COLORS = ['#6a9bcc', '#c98b5e', '#7fb08a', '#b07fb0', '#d4a63c', '#89a3b5'];
const EXAMPLES = ['tag:设计', 'domain:github.com', 'group:工作 未读', 'pinned', 'after:2026-01-01'];

export default function SmartFoldersDialog({ open, folders, counts, onClose, onSave }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef, onClose);
  const [draft, setDraft] = useState<{ id?: string; name: string; query: string; color: string } | null>(null);

  if (!open) return null;

  const startEdit = (f?: SmartFolder) => {
    setDraft(f
      ? { id: f.id, name: f.name, query: f.query, color: f.color }
      : { name: '', query: '', color: COLORS[folders.length % COLORS.length] });
  };

  const commit = () => {
    if (!draft?.name.trim() || !draft.query.trim()) return;
    let next: SmartFolder[];
    if (draft.id) {
      next = folders.map((f) => f.id === draft.id
        ? { ...f, name: draft.name.trim(), query: draft.query.trim(), color: draft.color }
        : f);
    } else {
      next = [...folders, {
        id: uid(), name: draft.name.trim(), query: draft.query.trim(), color: draft.color,
        createdAt: Date.now(), order: Date.now(),
      }];
    }
    onSave(next);
    setDraft(null);
  };

  const remove = (id: string) => {
    onSave(folders.filter((f) => f.id !== id));
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div ref={modalRef} tabIndex={-1} className="modal modal--wide" role="dialog" aria-modal="true" aria-label="智能文件夹" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2 className="modal__title">智能文件夹</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal__body">
          <p className="hint">把搜索条件保存为虚拟分组，像普通分组一样出现在侧栏。支持 tag / domain / group / before / after / unread / pinned。</p>
          <button className="btn btn--primary btn--sm" onClick={() => startEdit()}>
            <IconPlus size={13} /> 新建智能文件夹
          </button>

          {draft && (
            <div className="sf-editor">
              <div className="sf-editor__title">{draft.id ? '编辑' : '新建'}智能文件夹</div>
              <label className="field">
                <span>名称</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="如：设计灵感" autoFocus />
              </label>
              <label className="field">
                <span>查询条件</span>
                <input value={draft.query} onChange={(e) => setDraft({ ...draft, query: e.target.value })} placeholder="如：tag:设计 domain:figma.com" />
              </label>
              <div className="sf-editor__colors">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`sf-color ${draft.color === c ? 'is-active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setDraft({ ...draft, color: c })}
                    aria-label={`选择颜色 ${c}`}
                  />
                ))}
              </div>
              <div className="sf-editor__examples">
                <span>示例：</span>
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="chip" onClick={() => setDraft({ ...draft, query: ex })}>{ex}</button>
                ))}
              </div>
              <div className="sf-editor__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => setDraft(null)}>取消</button>
                <button className="btn btn--primary btn--sm" onClick={commit} disabled={!draft.name.trim() || !draft.query.trim()}>保存</button>
              </div>
            </div>
          )}

          <div className="sf-list">
            {folders.length === 0 ? (
              <p className="rb-empty">还没有智能文件夹</p>
            ) : folders.map((f) => (
              <div key={f.id} className="sf-row">
                <IconSmartFolder size={16} style={{ color: f.color, flexShrink: 0 }} />
                <div className="sf-row__body">
                  <strong>{f.name}</strong>
                  <code>{f.query}</code>
                </div>
                <em>{counts[f.id] ?? 0} 个</em>
                <button className="icon-btn icon-btn--sm" title="编辑" aria-label="编辑" onClick={() => startEdit(f)}><IconPencil size={13} /></button>
                <button className="icon-btn icon-btn--sm" title="删除" aria-label="删除" onClick={() => remove(f.id)}><IconTrash size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
