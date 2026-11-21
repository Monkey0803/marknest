import { useEffect, useRef, useState } from 'react';
import type { Bookmark, Group } from '../types';
import { getHost, isValidUrl, normalizeUrl } from '../lib/utils';
import { useModalFocus } from '../lib/useModalFocus';
import { IconClose, IconTag } from './Icons';
import GroupPicker from './GroupPicker';

interface Props {
  open: boolean;
  groups: Group[];
  editing: Bookmark | null;
  /** 新建时预填的内容（通常来自当前活动标签页） */
  preset?: { url: string; title: string } | null;
  /** 已有标签，用于输入时联想，避免同义标签越积越多 */
  tagSuggestions?: string[];
  defaultGroupId?: string | null;
  onRequestCreate: (onDone: (group: Group) => void) => void;
  onClose: () => void;
  onSave: (data: {
    title: string;
    url: string;
    description: string;
    groupId: string | null;
    tags: string[];
  }) => void;
}

export default function BookmarkDialog({
  open,
  groups,
  editing,
  preset = null,
  tagSuggestions = [],
  defaultGroupId = null,
  onRequestCreate,
  onClose,
  onSave,
}: Props) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [groupId, setGroupId] = useState<string>('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [urlTouched, setUrlTouched] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef, onClose);

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? preset?.title ?? '');
    setUrl(editing?.url ?? preset?.url ?? '');
    setDescription(editing?.description ?? '');
    setGroupId(editing?.groupId ?? defaultGroupId ?? '');
    setTags(editing?.tags ?? []);
    setTagInput('');
    setError('');
    setUrlTouched(false);
    setTimeout(() => titleRef.current?.focus(), 30);
  }, [open, editing, defaultGroupId, preset]);

  if (!open) return null;

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  const addTagValue = (t: string) => {
    if (!tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  // 输入时联想已有标签（前缀/包含匹配）；空输入时给几个常用标签快捷添加
  const tagQuery = tagInput.trim().replace(/^#/, '').toLowerCase();
  const tagHints = tagSuggestions
    .filter((t) => !tags.includes(t) && (!tagQuery || t.toLowerCase().includes(tagQuery)))
    .slice(0, tagQuery ? 6 : 5);

  /** 实时 URL 校验：输入过（失焦或提交后）才提示，避免刚打开就报错；输入合法即时消除 */
  const liveUrlInvalid = urlTouched && url.trim().length > 0 && !isValidUrl(url);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setUrlTouched(true);
    if (!url.trim() || !isValidUrl(url)) {
      setError(url.trim() ? '请输入有效的网址（例如 example.com）' : '请填写网址');
      return;
    }
    // 标题/网址框回车提交时标签框不会失焦，把尚未确认的输入一并收进来，避免静默丢失
    const pendingTag = tagInput.trim().replace(/^#/, '');
    const finalTags = pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags;
    onSave({
      title: title.trim() || getHost(normalizeUrl(url)),
      url: normalizeUrl(url),
      description: description.trim(),
      groupId: groupId || null,
      tags: finalTags,
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={modalRef}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? '编辑书签' : '添加书签'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="modal__title">{editing ? '编辑书签' : '添加新书签'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <IconClose size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="modal__body">
          <label className="field">
            <span className="field__label">网址</span>
            <input
              className="input"
              value={url}
              onChange={(e) => {
                const next = e.target.value;
                setUrl(next);
                // 输入已合法时即时清除提交残留的错误提示
                if (error && isValidUrl(next)) setError('');
              }}
              onBlur={() => setUrlTouched(true)}
              placeholder="https://example.com"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={liveUrlInvalid || !!error || undefined}
              aria-describedby={liveUrlInvalid || error ? 'url-field-error' : undefined}
            />
            {(liveUrlInvalid || error) && (
              <p id="url-field-error" className="form-error form-error--inline" role="alert">
                {error || '网址格式看起来不正确，例如 example.com'}
              </p>
            )}
          </label>

          <label className="field">
            <span className="field__label">标题</span>
            <input
              ref={titleRef}
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="给书签起个名字"
            />
          </label>

          <label className="field">
            <span className="field__label">描述 <em>可选</em></span>
            <textarea
              className="input input--area"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="关于这个书签的备注…"
              rows={2}
            />
          </label>

          <div className="field">
            <span className="field__label">分组</span>
            <GroupPicker
              groups={groups}
              value={groupId || null}
              onChange={(id) => setGroupId(id ?? '')}
              onRequestCreate={onRequestCreate}
            />
          </div>

          <div className="field">
            <span className="field__label">标签</span>
            <div className="tag-editor">
              {tags.map((t) => (
                <span key={t} className="tag-chip">
                  <IconTag size={11} /> {t}
                  <button
                    type="button"
                    className="tag-chip__x"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                    aria-label={`移除标签 ${t}`}
                  >
                    <IconClose size={11} />
                  </button>
                </span>
              ))}
              <input
                className="tag-editor__input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addTag();
                  }
                  if (e.key === 'Backspace' && !tagInput && tags.length) {
                    setTags(tags.slice(0, -1));
                  }
                }}
                onBlur={addTag}
                placeholder={tags.length ? '' : '输入后回车添加'}
              />
            </div>
            {tagHints.length > 0 && (
              <div className="tag-suggest" aria-label="已有标签">
                <span className="tag-suggest__hint">{tagQuery ? '匹配' : '常用'}</span>
                {tagHints.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="tag-suggest__item"
                    onMouseDown={(e) => { e.preventDefault(); addTagValue(t); }}
                  >
                    + {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn--primary">
              {editing ? '保存修改' : '添加书签'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
