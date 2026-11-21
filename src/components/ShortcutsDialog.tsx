import { useRef } from 'react';
import { useModalFocus } from '../lib/useModalFocus';
import { SHORTCUT_ACTIONS } from '../lib/features';
import { IconClose, IconKeyboard } from './Icons';

/** 固定的非自定义快捷键说明 */
const FIXED_ROWS: [string, string][] = [
  ['↑ / ↓', '在列表中移动焦点'],
  ['Enter', '打开当前焦点的书签'],
  ['Esc', '退出多选 / 清除搜索 / 关闭弹窗'],
  ['拖拽书签', '调整顺序；拖到分组上直接归类'],
  ['拖拽分组', '拖到另一分组上变成子分组；拖到「分组」标题移回顶层'],
  ['右键菜单', '快速收藏当前页面或链接'],
];

/** 把 Mod 展开为当前平台的显示符号 */
const displayCombo = (combo: string) =>
  combo.replace('Mod', /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl')
    .replace(/\+/g, ' + ');

interface Props {
  open: boolean;
  onClose: () => void;
  /** 用户自定义快捷键 */
  bindings?: Record<string, string>;
  onOpenSettings?: () => void;
}

export default function ShortcutsDialog({ open, onClose, bindings, onOpenSettings }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef, onClose);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div ref={modalRef} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label="快捷键" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2 className="modal__title">快捷键</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal__body">
          <div className="shortcuts">
            {SHORTCUT_ACTIONS.map((a) => (
              <div key={a.id} className="shortcut-row">
                <kbd className="kbd">{displayCombo(bindings?.[a.id] ?? a.default)}</kbd>
                <span>{a.label}</span>
              </div>
            ))}
            {FIXED_ROWS.map(([key, desc]) => (
              <div key={key} className="shortcut-row">
                <kbd className="kbd">{key}</kbd>
                <span>{desc}</span>
              </div>
            ))}
          </div>
          {onOpenSettings && (
            <button className="btn btn--ghost btn--sm" onClick={() => { onClose(); onOpenSettings(); }} style={{ marginTop: 12 }}>
              <IconKeyboard size={13} /> 自定义快捷键
            </button>
          )}
          <p className="hint hint--foot">提示：在网页上右键可直接使用「收藏此页面到 Marknest」。顶栏主题按钮按「浅色 → 深色 → 跟随浏览器」三态循环。</p>
        </div>
      </div>
    </div>
  );
}
