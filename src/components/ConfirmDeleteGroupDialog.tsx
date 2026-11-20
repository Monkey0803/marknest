import { useRef } from 'react';
import { useModalFocus } from '../lib/useModalFocus';
import { IconClose, IconTrash } from './Icons';

interface Props {
  open: boolean;
  /** 分组名称 */
  name: string;
  /** 直接 + 间接子分组数量 */
  childGroups: number;
  /** 该子树下的书签数量 */
  bookmarkCount: number;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * 删除分组前的确认：明确告知「会牵连多少子分组和书签」，
 * 让用户在选择删除前就知情，而不是删完靠 toast 补救。
 */
export default function ConfirmDeleteGroupDialog({
  open, name, childGroups, bookmarkCount, onConfirm, onClose,
}: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={modalRef}
        tabIndex={-1}
        className="modal modal--confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        aria-describedby="confirm-delete-desc"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 id="confirm-delete-title" className="modal__title">删除分组「{name}」</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal__body">
          <p id="confirm-delete-desc" className="confirm__lead">
            删除分组不会删除书签本身，但会改变它们的位置：
          </p>
          <ul className="confirm__impact">
            <li>
              <strong>{childGroups}</strong> 个子分组将上移一级
            </li>
            <li>
              <strong>{bookmarkCount}</strong> 个书签（含子分组内）将移到上级，不再归入此分组
            </li>
          </ul>
          <p className="confirm__note">删除后 6 秒内可点底部提示「撤销」恢复原状。</p>
          <div className="modal__actions">
            <button className="btn btn--ghost" onClick={onClose}>取消</button>
            <button className="btn btn--danger" onClick={onConfirm} autoFocus>
              <IconTrash size={14} /> 确认删除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
