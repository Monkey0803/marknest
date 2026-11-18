import { useState } from 'react';
import type { Group } from '../types';
import { buildGroupTree, flattenGroupTree, groupSubtreeIds } from '../lib/utils';
import {
  IconClose, IconTrash, IconPencil, IconPlus, IconMoveTo, IconFolderPlus,
} from './Icons';
import ColorPicker from './ColorPicker';
import SaveToGroupMenu from './SaveToGroupMenu';

interface Props {
  open: boolean;
  groups: Group[];
  counts: Record<string, number>;
  onClose: () => void;
  onRequestCreate: (parentId: string | null) => void;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  /** 整组移动：把分组挂到 parentId 下（null = 移到顶层） */
  onMove: (id: string, parentId: string | null) => void;
}

export default function GroupDialog({
  open, groups, counts, onClose, onRequestCreate, onRename, onRecolor, onDelete, onMove,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  /** 移动到分组的菜单：记录被移动的分组与按钮位置 */
  const [moveState, setMoveState] = useState<{ id: string; rect: DOMRect } | null>(null);

  if (!open) return null;

  const rows = flattenGroupTree(buildGroupTree(groups));

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="管理分组"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="modal__title">管理分组</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <IconClose size={18} />
          </button>
        </div>

        <div className="modal__body">
          <button className="group-create-trigger" onClick={() => onRequestCreate(null)}>
            <span className="group-create-trigger__icon"><IconPlus size={16} /></span>
            <span>新建分组</span>
          </button>

          <div className="group-list">
            {groups.length === 0 && (
              <p className="hint">还没有分组。创建一个来整理你的书签。</p>
            )}
            {rows.map(({ group: g, depth, children }) => (
              <div
                key={g.id}
                className={`group-row ${depth ? 'group-row--nested' : ''}`}
                style={depth ? { marginLeft: depth * 18 } : undefined}
              >
                {depth > 0 && <span className="group-row__branch" aria-hidden="true">└</span>}
                <ColorPicker color={g.color} name={g.name} onChange={(c) => onRecolor(g.id, c)} />
                {editingId === g.id ? (
                  <input
                    className="input input--inline"
                    value={editingName}
                    autoFocus
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => {
                      if (editingName.trim()) onRename(g.id, editingName.trim());
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editingName.trim()) onRename(g.id, editingName.trim());
                        setEditingId(null);
                      }
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <span
                    className="group-row__name"
                    onDoubleClick={() => {
                      setEditingId(g.id);
                      setEditingName(g.name);
                    }}
                    title={g.name}
                  >
                    {g.name}
                  </span>
                )}
                <span className="group-row__count">{counts[g.id] ?? 0}</span>
                <button
                  className="icon-btn icon-btn--sm"
                  onClick={() => onRequestCreate(g.id)}
                  aria-label={`在「${g.name}」下新建子分组`}
                  title="新建子分组"
                >
                  <IconFolderPlus size={14} />
                </button>
                <button
                  className="icon-btn icon-btn--sm"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMoveState({ id: g.id, rect });
                  }}
                  aria-label={`移动分组 ${g.name}`}
                  title="移动到其他分组"
                >
                  <IconMoveTo size={14} />
                </button>
                <button
                  className="icon-btn icon-btn--sm"
                  onClick={() => {
                    setEditingId(g.id);
                    setEditingName(g.name);
                  }}
                  aria-label={`重命名 ${g.name}`}
                >
                  <IconPencil size={14} />
                </button>
                <button
                  className="icon-btn icon-btn--sm icon-btn--danger"
                  onClick={() => onDelete(g.id)}
                  aria-label={`删除分组 ${g.name}`}
                  title={children.length ? '删除后子分组会上移一层' : '删除分组'}
                >
                  <IconTrash size={14} />
                </button>
              </div>
            ))}
          </div>
          <p className="hint hint--foot">
            分组可以嵌套：拖拽侧栏里的分组到另一个分组上，或用「移动」按钮整组移动。
            删除分组不会删除书签，子分组会向上提升一级。
          </p>
        </div>
      </div>

      {moveState && (
        <SaveToGroupMenu
          groups={groups}
          bookmarks={[]}
          defaultGroupId={groups.find((g) => g.id === moveState.id)?.parentId ?? null}
          anchor={moveState.rect}
          title={`移动「${groups.find((g) => g.id === moveState.id)?.name ?? ''}」到`}
          nullLabel="顶层（移出嵌套）"
          showCounts={false}
          showCreate={false}
          hierarchical
          excludeIds={groupSubtreeIds(groups, moveState.id)}
          onPick={(parentId) => {
            onMove(moveState.id, parentId);
            setMoveState(null);
          }}
          onRequestCreate={() => setMoveState(null)}
          onClose={() => setMoveState(null)}
        />
      )}
    </div>
  );
}
