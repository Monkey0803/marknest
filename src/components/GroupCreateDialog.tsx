import { useEffect } from 'react';
import { IconClose, IconFolderPlus } from './Icons';
import GroupCreateForm from './GroupCreateForm';

interface Props {
  open: boolean;
  /** 父分组名称：在某个分组下新建子分组时展示上下文 */
  parentName?: string | null;
  /** 提交创建，由 App 层统一落库并回调各入口 */
  onSubmit: (name: string, color: string) => void;
  onClose: () => void;
}

/**
 * 全应用统一的新建分组对话框。
 * 所有入口（侧栏、收藏菜单、书签弹窗、管理面板）都打开它，
 * 保证「同一个面板」的一致体验与舒展排版。
 */
export default function GroupCreateDialog({ open, parentName, onSubmit, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal gcd"
        role="dialog"
        aria-modal="true"
        aria-label="新建分组"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head gcd__head">
          <div className="gcd__heading">
            <span className="gcd__icon"><IconFolderPlus size={19} /></span>
            <div>
              <h2 className="modal__title">{parentName ? '新建子分组' : '新建分组'}</h2>
              <p className="gcd__subtitle">
                {parentName ? `将创建在「${parentName}」之下` : '整理书签，让每一类都清晰有序'}
              </p>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <IconClose size={18} />
          </button>
        </div>

        <div className="gcd__body">
          <GroupCreateForm submitLabel={parentName ? '创建子分组' : '创建分组'} onSubmit={onSubmit} />
        </div>
      </div>
    </div>
  );
}
