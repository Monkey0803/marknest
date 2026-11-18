import type { Group } from '../types';
import { buildGroupTree, flattenGroupTree } from '../lib/utils';
import { IconPlus } from './Icons';

export { PALETTE } from './GroupCreateForm';

const NEW_VALUE = '__create_new_group__';

interface Props {
  groups: Group[];
  /** 当前选中的分组 id；null 表示「未分组」 */
  value: string | null;
  onChange: (id: string | null) => void;
  /** 请求新建分组：由 App 打开统一对话框，创建成功后回调 group */
  onRequestCreate: (onDone: (group: Group) => void) => void;
  /** 紧凑模式（工具栏内使用） */
  compact?: boolean;
}

/**
 * 分组选择器：一个下拉框。选「＋ 新建分组…」时请求全局统一对话框，
 * 创建成功后自动选中新分组。面板本身不内联，保证入口间体验一致。
 */
export default function GroupPicker({
  groups, value, onChange, onRequestCreate, compact = false,
}: Props) {
  return (
    <div className={`group-picker ${compact ? 'group-picker--compact' : ''}`}>
      <select
        className="input input--select group-picker__select"
        value={value ?? ''}
        onChange={(e) => {
          if (e.target.value === NEW_VALUE) {
            onRequestCreate((group) => onChange(group.id));
          } else {
            onChange(e.target.value || null);
          }
        }}
        aria-label="选择分组"
      >
        <option value="">未分组</option>
        {flattenGroupTree(buildGroupTree(groups)).map(({ group: g, depth }) => (
          <option key={g.id} value={g.id}>
            {depth ? `${'　'.repeat(depth)}└ ${g.name}` : g.name}
          </option>
        ))}
        <option value={NEW_VALUE}>＋ 新建分组…</option>
      </select>
      {compact && (
        <IconPlus size={13} className="group-picker__compact-icon" aria-hidden="true" />
      )}
    </div>
  );
}
