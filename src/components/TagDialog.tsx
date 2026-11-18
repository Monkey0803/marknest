import { useEffect, useState } from 'react';
import { IconClose, IconTag, IconTrash, IconCheck } from './Icons';

interface Props {
  open: boolean;
  tags: { tag: string; count: number }[];
  onClose: () => void;
  /** 重命名标签；目标已存在时等价于合并 */
  onRename: (from: string, to: string) => void;
  onDelete: (tag: string) => void;
}

function TagRow({
  tag, count, onRename, onDelete,
}: {
  tag: string;
  count: number;
  onRename: (from: string, to: string) => void;
  onDelete: (tag: string) => void;
}) {
  const [draft, setDraft] = useState(tag);
  const [focused, setFocused] = useState(false);

  useEffect(() => setDraft(tag), [tag]);

  const commit = () => {
    const next = draft.trim();
    if (!next || next === tag) {
      setDraft(tag);
      return;
    }
    onRename(tag, next);
  };

  const dirty = draft.trim() !== tag && draft.trim().length > 0;

  return (
    <div className={`tag-row ${focused ? 'is-editing' : ''}`}>
      <span className="tag-row__icon"><IconTag size={13} /></span>
      <input
        className="input input--inline tag-row__input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setDraft(tag); (e.target as HTMLInputElement).blur(); }
        }}
        aria-label={`标签 ${tag} 的新名称`}
        maxLength={24}
      />
      {dirty ? (
        <button className="icon-btn icon-btn--sm" onClick={commit} title="保存" aria-label="保存名称">
          <IconCheck size={13} />
        </button>
      ) : (
        <span className="tag-row__count">{count}</span>
      )}
      <button
        className="icon-btn icon-btn--sm icon-btn--danger"
        onClick={() => onDelete(tag)}
        title="从所有书签中移除该标签"
        aria-label={`删除标签 ${tag}`}
      >
        <IconTrash size={13} />
      </button>
    </div>
  );
}

/** 标签管理：重命名/合并/删除。改名到已存在的标签会自动合并。 */
export default function TagDialog({ open, tags, onClose, onRename, onDelete }: Props) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="管理标签"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="modal__title">管理标签</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal__body">
          {tags.length === 0 ? (
            <p className="hint">还没有标签。给书签加标签后会在这里出现。</p>
          ) : (
            <div className="tag-list">
              {tags.map((t) => (
                <TagRow
                  key={t.tag}
                  tag={t.tag}
                  count={t.count}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              ))}
            </div>
          )}
          <p className="hint hint--foot">
            点标签名即可改名；改成已有标签名会自动合并。删除标签不会删除书签。
          </p>
        </div>
      </div>
    </div>
  );
}
