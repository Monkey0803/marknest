import { useRef } from 'react';
import { useModalFocus } from '../lib/useModalFocus';
import { IconClose } from './Icons';

const ROWS: [string, string][] = [
  ['⌘ / Ctrl + K', '快速切换：搜书签、分组或命令'],
  ['/', '聚焦搜索框'],
  ['⌘ / Ctrl + N', '新建书签'],
  ['⌘ / Ctrl + ⇧ + L', '定位当前页面在书签中的位置'],
  ['↑ / ↓', '在列表中移动焦点'],
  ['Enter', '打开当前焦点的书签'],
  ['X', '多选当前书签'],
  ['⌘ / Ctrl + A', '全选当前列表'],
  ['⌘ / Ctrl + Z', '撤销上一步改动（可连续回退 20 步）'],
  ['⌘ / Ctrl + ⇧ + Z', '重做（也可按 ⌘ / Ctrl + Y）'],
  ['Esc', '退出多选 / 清除搜索 / 关闭弹窗'],
  ['拖拽书签', '调整顺序；拖到分组上直接归类'],
  ['拖拽分组', '拖到另一分组上变成子分组；拖到「分组」标题移回顶层'],
  ['右键菜单', '快速收藏当前页面或链接'],
];

export default function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef);

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
            {ROWS.map(([key, desc]) => (
              <div key={key} className="shortcut-row">
                <kbd className="kbd">{key}</kbd>
                <span>{desc}</span>
              </div>
            ))}
          </div>
          <p className="hint hint--foot">提示：在网页上右键可直接使用「收藏此页面到 Marknest」。</p>
        </div>
      </div>
    </div>
  );
}
