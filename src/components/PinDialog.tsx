import { useRef, useState } from 'react';
import { useModalFocus } from '../lib/useModalFocus';
import { verifyPin } from '../lib/features';
import { IconClose, IconLock } from './Icons';

interface Props {
  open: boolean;
  hash?: string;
  groupName: string;
  onClose: () => void;
  onUnlocked: () => void;
  onError?: () => void;
}

export default function PinDialog({ open, hash, groupName, onClose, onUnlocked }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef, onClose);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  if (!open) return null;
  const submit = () => {
    if (verifyPin(pin, hash)) {
      setPin('');
      setError('');
      onUnlocked();
    } else {
      setError('PIN 不正确，请重试');
      setPin('');
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div ref={modalRef} tabIndex={-1} className="modal modal--sm" role="dialog" aria-modal="true" aria-label="解锁私密分组" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2 className="modal__title"><IconLock size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />私密分组</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal__body">
          <p className="hint">「{groupName}」是私密分组，请输入 PIN 查看其中的书签。</p>
          <label className="field">
            <span>PIN</span>
            <input type="password" value={pin} onChange={(e) => { setPin(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="输入 PIN" autoFocus />
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal__foot">
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={submit} disabled={!pin}>解锁</button>
        </div>
      </div>
    </div>
  );
}
