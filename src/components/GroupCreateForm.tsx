import { useEffect, useRef, useState } from 'react';
import { IconCheck } from './Icons';

/** 分组预设调色板（全应用统一） */
export const PALETTE = [
  '#6a9bcc', '#d2683f', '#788c5d', '#c99a3b',
  '#b5657a', '#5f8f8a', '#8a7fb5', '#8c8375',
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface Props {
  /** 提交（新建）：name 已 trim，color 为合法 #rrggbb */
  onSubmit: (name: string, color: string) => void;
  submitLabel?: string;
  placeholder?: string;
  /** 默认聚焦名称输入框 */
  autoFocus?: boolean;
}

/**
 * 新建分组表单内核。统一由 GroupCreateDialog 以模态框承载，
 * 不再内联到窄容器中，保证各入口呈现完全一致、排版舒展。
 */
export default function GroupCreateForm({
  onSubmit,
  submitLabel = '创建分组',
  placeholder = '给分组起个名字',
  autoFocus = true,
}: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [hex, setHex] = useState(PALETTE[0]);
  const nameRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => nameRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const setBoth = (c: string) => {
    setColor(c);
    setHex(c.toLowerCase());
  };

  const onHexInput = (raw: string) => {
    let v = raw.trim().replace(/^#/, '').toLowerCase();
    if (v.length > 6) v = v.slice(0, 6);
    setHex(v ? `#${v}` : '');
    if (HEX_RE.test(`#${v}`)) setColor(`#${v}`);
  };

  const onHexBlur = () => {
    if (!HEX_RE.test(hex)) setHex(color);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || !HEX_RE.test(color)) return;
    onSubmit(trimmed, color);
    setName('');
    setBoth(PALETTE[0]);
  };

  const previewName = name.trim() || '未命名分组';

  return (
    <div className="gcf">
      {/* 实时预览 */}
      <div className="gcf__preview">
        <span className="gcf__preview-dot" style={{ background: color }} />
        <span className="gcf__preview-name">{previewName}</span>
        <span className="gcf__preview-tag">预览</span>
      </div>

      <label className="gcf__field">
        <span className="gcf__label">分组名称</span>
        <input
          ref={nameRef}
          className="input gcf__name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
          }}
          placeholder={placeholder}
          aria-label="新分组名称"
          maxLength={24}
        />
      </label>

      <div className="gcf__field">
        <span className="gcf__label">选择颜色</span>
        <div className="gcf__swatches" role="group" aria-label="选择预设颜色">
          {PALETTE.map((c) => (
            <button
              type="button"
              key={c}
              className={`gcf__swatch ${color.toLowerCase() === c ? 'is-selected' : ''}`}
              style={{ background: c }}
              onClick={() => setBoth(c)}
              aria-label={`选择颜色 ${c}`}
              title={c}
            >
              {color.toLowerCase() === c && <IconCheck size={13} />}
            </button>
          ))}
        </div>
      </div>

      <label className="gcf__field">
        <span className="gcf__label">自定义颜色</span>
        <div className="gcf__custom">
          <button
            type="button"
            className="gcf__picker"
            style={{ background: color }}
            onClick={() => colorRef.current?.click()}
            aria-label="打开自定义取色器"
            title="自定义取色器"
          />
          <input
            ref={colorRef}
            type="color"
            className="gcf__color-input"
            value={HEX_RE.test(color) ? color : PALETTE[0]}
            onChange={(e) => setBoth(e.target.value)}
            aria-label="自定义颜色取色器"
            tabIndex={-1}
          />
          <div className="gcf__hex-wrap">
            <span className="gcf__hash">#</span>
            <input
              className="gcf__hex"
              value={hex.replace(/^#/, '')}
              onChange={(e) => onHexInput(e.target.value)}
              onBlur={onHexBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
              }}
              placeholder="RRGGBB"
              aria-label="自定义颜色 HEX 值"
              maxLength={6}
              spellCheck={false}
            />
          </div>
          <span className="gcf__custom-hint">HEX</span>
        </div>
      </label>

      <button
        type="button"
        className="btn btn--primary gcf__submit"
        onClick={submit}
        disabled={!name.trim()}
      >
        <IconCheck size={15} /> {submitLabel}
      </button>
    </div>
  );
}
