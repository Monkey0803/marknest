import { useRef, useState } from 'react';
import { useModalFocus } from '../lib/useModalFocus';
import { IconClose, IconEdit } from './Icons';

type Mode = 'desc' | 'url' | 'rename';

interface Props {
  open: boolean;
  count: number;
  onClose: () => void;
  onSetDescription: (value: string) => void;
  onReplaceUrl: (from: string, to: string) => void;
  onRename: (find: string, replace: string, prefix: string, suffix: string) => void;
}

export default function BatchEditDialog({ open, count, onClose, onSetDescription, onReplaceUrl, onRename }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef, onClose);
  const [mode, setMode] = useState<Mode>('desc');
  const [desc, setDesc] = useState('');
  const [urlFrom, setUrlFrom] = useState('http://');
  const [urlTo, setUrlTo] = useState('https://');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');

  if (!open) return null;

  const submit = () => {
    if (mode === 'desc') onSetDescription(desc);
    else if (mode === 'url') onReplaceUrl(urlFrom, urlTo);
    else onRename(find, replace, prefix, suffix);
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div ref={modalRef} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label="批量编辑" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2 className="modal__title"><IconEdit size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />批量编辑 {count} 个书签</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal__body">
          <div className="tabs-inline" role="tablist">
            <button className={mode === 'desc' ? 'is-active' : ''} onClick={() => setMode('desc')}>改备注</button>
            <button className={mode === 'url' ? 'is-active' : ''} onClick={() => setMode('url')}>替换网址</button>
            <button className={mode === 'rename' ? 'is-active' : ''} onClick={() => setMode('rename')}>重命名</button>
          </div>

          {mode === 'desc' && (
            <label className="field">
              <span>新备注（留空则清空所有选中项的备注）</span>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} placeholder="输入备注内容…" autoFocus />
            </label>
          )}
          {mode === 'url' && (
            <>
              <p className="hint">只替换以「原前缀」开头的网址，其余保持不变。</p>
              <label className="field"><span>原前缀</span><input value={urlFrom} onChange={(e) => setUrlFrom(e.target.value)} placeholder="http://" autoFocus /></label>
              <label className="field"><span>新前缀</span><input value={urlTo} onChange={(e) => setUrlTo(e.target.value)} placeholder="https://" /></label>
            </>
          )}
          {mode === 'rename' && (
            <>
              <label className="field"><span>查找（留空则不加替换）</span><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="要替换的文字" autoFocus /></label>
              <label className="field"><span>替换为</span><input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="新文字" /></label>
              <label className="field"><span>标题前缀</span><input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="可选" /></label>
              <label className="field"><span>标题后缀</span><input value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="可选" /></label>
            </>
          )}
        </div>
        <div className="modal__foot">
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={submit}>应用到 {count} 个书签</button>
        </div>
      </div>
    </div>
  );
}
