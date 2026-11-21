import { useEffect, useRef, useState } from 'react';
import { useModalFocus } from '../lib/useModalFocus';
import { IconClose, IconTag, IconTrash, IconCheck, IconMerge } from './Icons';

interface DuplicateTagGroup {
  canonical: string;
  members: { tag: string; count: number }[];
  total: number;
}

interface Props {
  open: boolean;
  tags: { tag: string; count: number }[];
  /** 语义重复的标签组（仅大小写/全半角/空白差异），供一键合并 */
  duplicates?: DuplicateTagGroup[];
  onMerge?: (group: DuplicateTagGroup) => void;
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
export default function TagDialog({
  open, tags, duplicates = [], onMerge, onClose, onRename, onDelete,
}: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef, onClose);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={modalRef}
        tabIndex={-1}
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
          {duplicates.length > 0 && (
            <section className="dup-tags">
              <h3 className="dup-tags__title">发现 {duplicates.length} 组重复标签</h3>
              {duplicates.map((group) => (
                <div key={group.canonical} className="dup-tags__row">
                  <span className="dup-tags__names">
                    {group.members.map((m) => (
                      <span key={m.tag} className={m.tag === group.canonical ? 'is-canonical' : ''}>
                        {m.tag}<em>×{m.count}</em>
                      </span>
                    ))}
                  </span>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => onMerge?.(group)}
                    title={`把其余写法合并为「${group.canonical}」`}
                  >
                    <IconMerge size={13} /> 合并为「{group.canonical}」
                  </button>
                </div>
              ))}
              <p className="hint">仅大小写、全半角或空格写法不同的标签会在这里出现，合并后书签不变、只统一标签名。</p>
            </section>
          )}
          {tags.length === 0 ? (
            duplicates.length === 0 && <p className="hint">还没有标签。给书签加标签后会在这里出现。</p>
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
