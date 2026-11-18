import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck } from './Icons';
import { PALETTE } from './GroupCreateForm';

interface Props {
  color: string;
  name: string;
  onChange: (color: string) => void;
}

/**
 * 分组颜色选择器：行内只显示当前颜色的圆点按钮，
 * 点击后以 portal 弹出精致色板，避免被 modal__body 的 overflow 裁切。
 */
export default function ColorPicker({ color, name, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });

  const isCustom = !PALETTE.includes(color);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const anchor = btnRef.current.getBoundingClientRect();
    const margin = 8;
    const popW = 208;
    const popH = 92;
    // 优先放在触发器右侧并垂直居中，避免遮挡行内的分组名
    let left = anchor.right + 8;
    if (left + popW > window.innerWidth - margin) {
      left = anchor.left - popW - 8;
    }
    left = Math.max(margin, left);
    let top = anchor.top + anchor.height / 2 - popH / 2;
    top = Math.max(margin, Math.min(top, window.innerHeight - popH - margin));
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`color-picker__trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={`更改 ${name} 的颜色`}
        aria-expanded={open}
        title="更改颜色"
      >
        <span className="color-picker__dot" style={{ background: color }} />
      </button>

      {open && createPortal(
        <div
          ref={popRef}
          className="color-pop"
          role="dialog"
          aria-label={`选择 ${name} 的颜色`}
          style={{ top: pos.top, left: pos.left, visibility: pos.top < 0 ? 'hidden' : 'visible' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="color-pop__swatches">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-pop__swatch ${color === c ? 'is-selected' : ''}`}
                style={{ background: c }}
                onClick={() => { onChange(c); setOpen(false); }}
                aria-label={`颜色 ${c}`}
                title={c}
              >
                {color === c && <IconCheck size={13} />}
              </button>
            ))}
          </div>
          {isCustom && (
            <div className="color-pop__custom">
              <span className="color-pop__custom-dot" style={{ background: color }} />
              <span>当前自定义色 {color}</span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
