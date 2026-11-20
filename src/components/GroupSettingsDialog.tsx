import { useEffect, useRef, useState } from 'react';
import type { Group } from '../types';
import { groupSubtreeIds } from '../lib/utils';
import { useModalFocus } from '../lib/useModalFocus';
import { PALETTE } from './GroupCreateForm';
import { IconCheck, IconClose, IconTrash, IconFolderPlus, IconMoveTo } from './Icons';
import SaveToGroupMenu from './SaveToGroupMenu';

interface Props {
  group: Group | null;
  groups: Group[];
  count: number;
  onClose: () => void;
  onSave: (patch: { name?: string; color?: string }) => void;
  onDelete: (id: string) => void;
  onCreateSub: (parentId: string) => void;
  /** 整组移动：把分组挂到 parentId 下（null = 移到顶层） */
  onMove: (id: string, parentId: string | null) => void;
}

/**
 * 当前分组设置：从内容区标题栏的「管理」入口唤出，
 * 不必进入「管理分组」面板即可改名、换色、移动、建子分组、删除。
 */
export default function GroupSettingsDialog({
  group, groups, count, onClose, onSave, onDelete, onCreateSub, onMove,
}: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  /** 移动到分组的菜单锚点 */
  const [moveAnchor, setMoveAnchor] = useState<DOMRect | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(!!group, modalRef);

  useEffect(() => {
    if (group) {
      setName(group.name);
      setColor(group.color);
    }
  }, [group]);

  if (!group) return null;

  const dirty = name.trim() !== group.name || color !== group.color;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={modalRef}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`分组设置：${group.name}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="modal__title">分组设置</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal__body">
          <p className="hint">{group.name} · {count} 个书签</p>
          <div className="group-settings__swatches" role="radiogroup" aria-label="分组颜色">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-pop__swatch ${color === c ? 'is-selected' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`颜色 ${c}`}
                title={c}
              >
                {color === c && <IconCheck size={13} />}
              </button>
            ))}
          </div>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim() && dirty) {
                onSave({ name: name.trim(), color });
                onClose();
              }
            }}
            placeholder="分组名称"
            aria-label="分组名称"
            maxLength={30}
            autoFocus
          />
          <div className="group-settings__actions">
            <button className="btn btn--ghost btn--sm" onClick={() => { onCreateSub(group.id); onClose(); }}>
              <IconFolderPlus size={14} /> 新建子分组
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={(e) => setMoveAnchor(e.currentTarget.getBoundingClientRect())}
            >
              <IconMoveTo size={14} /> 移动
            </button>
            <button
              className="btn btn--danger btn--sm"
              onClick={() => { onDelete(group.id); onClose(); }}
              title="删除分组不会删除书签，子分组与书签会上移一级"
            >
              <IconTrash size={14} /> 删除
            </button>
            <span className="group-settings__spacer" />
            <button
              className="btn btn--primary btn--sm"
              disabled={!dirty || !name.trim()}
              onClick={() => { onSave({ name: name.trim(), color }); onClose(); }}
            >
              保存
            </button>
          </div>
        </div>
      </div>

      {moveAnchor && (
        <SaveToGroupMenu
          groups={groups}
          bookmarks={[]}
          defaultGroupId={group.parentId}
          anchor={moveAnchor}
          title={`移动「${group.name}」到`}
          nullLabel="顶层（移出嵌套）"
          showCounts={false}
          showCreate={false}
          hierarchical
          excludeIds={groupSubtreeIds(groups, group.id)}
          onPick={(parentId) => {
            setMoveAnchor(null);
            onMove(group.id, parentId);
          }}
          onRequestCreate={() => setMoveAnchor(null)}
          onClose={() => setMoveAnchor(null)}
        />
      )}
    </div>
  );
}
