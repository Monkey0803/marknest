import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ArchiveConfig, AutoTagRule, BrowserSyncState, HealthMonitor, Settings,
} from '../types';
import { SHORTCUT_ACTIONS, hashPin, keyComboFromEvent } from '../lib/features';
import { useModalFocus } from '../lib/useModalFocus';
import { uid } from '../lib/utils';
import {
  IconClose, IconWand, IconTabs, IconArchive, IconAlert, IconKeyboard, IconSliders, IconLock,
  IconPlus, IconTrash, IconRefresh,
} from './Icons';

type Tab = 'general' | 'autotag' | 'browsersync' | 'health' | 'archive' | 'shortcuts' | 'privacy';

interface Props {
  open: boolean;
  settings: Settings;
  archivedCount: number;
  onClose: () => void;
  onPatch: (patch: Partial<Settings>) => void;
  onRunArchive: (days: number) => void;
  onUnarchiveAll: () => void;
  onRunHealthCheck: () => void;
  onSetPin: (hash: string | undefined) => void;
}

export default function SettingsDialog({
  open, settings, archivedCount, onClose, onPatch,
  onRunArchive, onUnarchiveAll, onRunHealthCheck, onSetPin,
}: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef, onClose);
  const [tab, setTab] = useState<Tab>('general');
  const [newRule, setNewRule] = useState<{ kind: 'domain' | 'keyword'; pattern: string; tags: string }>({ kind: 'domain', pattern: '', tags: '' });
  const [pinInput, setPinInput] = useState('');
  const [recording, setRecording] = useState<string | null>(null);

  if (!open) return null;

  const patchBrowserSync = (patch: Partial<BrowserSyncState>) =>
    onPatch({ browserSync: { ...settings.browserSync, ...patch } });
  const patchHealth = (patch: Partial<HealthMonitor>) =>
    onPatch({ healthMonitor: { ...settings.healthMonitor, ...patch } });
  const patchArchive = (patch: Partial<ArchiveConfig>) =>
    onPatch({ archive: { ...settings.archive, ...patch } });

  const addRule = () => {
    const pattern = newRule.pattern.trim();
    const tags = newRule.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    if (!pattern || tags.length === 0) return;
    const rule: AutoTagRule = { id: uid(), kind: newRule.kind, pattern, tags, createdAt: Date.now() };
    onPatch({ autoTagRules: [...settings.autoTagRules, rule] });
    setNewRule({ ...newRule, pattern: '', tags: '' });
  };

  const tabs: { id: Tab; label: string; icon?: ReactNode }[] = [
    { id: 'general', label: '常规', icon: <IconSliders size={13} /> },
    { id: 'autotag', label: '自动标签', icon: <IconWand size={13} /> },
    { id: 'browsersync', label: '浏览器同步', icon: <IconTabs size={13} /> },
    { id: 'health', label: '死链巡检', icon: <IconAlert size={13} /> },
    { id: 'archive', label: '分层存储', icon: <IconArchive size={13} /> },
    { id: 'shortcuts', label: '快捷键', icon: <IconKeyboard size={13} /> },
    { id: 'privacy', label: '私密', icon: <IconLock size={13} /> },
  ];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div ref={modalRef} tabIndex={-1} className="modal modal--wide settings-modal" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2 className="modal__title">设置</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button>
        </div>
        <div className="settings-layout">
          <nav className="settings-nav" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} className={`settings-nav__item ${tab === t.id ? 'is-active' : ''}`} onClick={() => setTab(t.id)} role="tab" aria-selected={tab === t.id}>
                {t.icon}{t.label}
              </button>
            ))}
          </nav>
          <div className="settings-body">
            {tab === 'general' && (
              <>
                <h3>常规</h3>
                <label className="toggle-row">
                  <span><strong>清理追踪参数</strong><small>收藏时自动移除 utm_*、fbclid 等参数，不影响去重与正常 query</small></span>
                  <input type="checkbox" checked={settings.stripTracking} onChange={(e) => onPatch({ stripTracking: e.target.checked })} />
                </label>
                <p className="hint hint--foot">更多设置请见左侧各分类。所有改动即时保存并随 Google 账户同步。</p>
              </>
            )}

            {tab === 'autotag' && (
              <>
                <h3>自动打标签规则</h3>
                <p className="hint">收藏书签时按域名或关键词命中规则，自动追加标签。</p>
                <div className="rule-add">
                  <select value={newRule.kind} onChange={(e) => setNewRule({ ...newRule, kind: e.target.value as 'domain' | 'keyword' })}>
                    <option value="domain">域名</option>
                    <option value="keyword">关键词</option>
                  </select>
                  <input value={newRule.pattern} onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })} placeholder={newRule.kind === 'domain' ? 'github.com' : '设计'} aria-label="匹配值" />
                  <input value={newRule.tags} onChange={(e) => setNewRule({ ...newRule, tags: e.target.value })} placeholder="标签，多个用逗号" aria-label="标签" />
                  <button className="btn btn--primary btn--sm" onClick={addRule}><IconPlus size={13} /> 添加</button>
                </div>
                <div className="rule-list">
                  {settings.autoTagRules.length === 0 ? <p className="rb-empty">还没有规则</p> : settings.autoTagRules.map((r) => (
                    <div key={r.id} className="rule-row">
                      <span className="rule-kind">{r.kind === 'domain' ? '域名' : '关键词'}</span>
                      <code>{r.pattern}</code>
                      <span className="rule-arrow">→</span>
                      <div className="rule-tags">{r.tags.map((t) => <em key={t}>{t}</em>)}</div>
                      <button className="icon-btn icon-btn--sm" title="删除" aria-label="删除规则" onClick={() => onPatch({ autoTagRules: settings.autoTagRules.filter((x) => x.id !== r.id) })}><IconTrash size={13} /></button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === 'browsersync' && (
              <>
                <h3>浏览器书签增量同步</h3>
                <label className="toggle-row">
                  <span><strong>开启自动同步</strong><small>浏览器书签新增/改名/移动/删除时自动合并进 Marknest</small></span>
                  <input type="checkbox" checked={settings.browserSync.enabled} onChange={(e) => patchBrowserSync({ enabled: e.target.checked })} />
                </label>
                <label className="toggle-row">
                  <span><strong>同步文件夹为分组</strong><small>把浏览器书签文件夹映射为 Marknest 分组</small></span>
                  <input type="checkbox" checked={settings.browserSync.syncFolders} onChange={(e) => patchBrowserSync({ syncFolders: e.target.checked })} />
                </label>
                <label className="toggle-row">
                  <span><strong>删除同步到回收站</strong><small>浏览器里删掉的书签进入回收站（可还原），而非直接消失</small></span>
                  <input type="checkbox" checked={settings.browserSync.syncRemovals} onChange={(e) => patchBrowserSync({ syncRemovals: e.target.checked })} />
                </label>
                <p className="hint hint--foot">
                  {settings.browserSync.lastSyncedAt
                    ? `上次合并：${new Date(settings.browserSync.lastSyncedAt).toLocaleString('zh-CN')}`
                    : '尚未同步。开启后，浏览器书签的改动会在扩展打开时自动合并。'}
                </p>
              </>
            )}

            {tab === 'health' && (
              <>
                <h3>死链巡检</h3>
                <label className="toggle-row">
                  <span><strong>开启定期巡检</strong><small>后台定时提示检测死链，打开扩展时可执行检测并在数据面板查看结果</small></span>
                  <input type="checkbox" checked={settings.healthMonitor.enabled} onChange={(e) => patchHealth({ enabled: e.target.checked })} />
                </label>
                <label className="field">
                  <span>检测间隔（小时）</span>
                  <input type="number" min={1} max={720} value={settings.healthMonitor.intervalHours} onChange={(e) => patchHealth({ intervalHours: Math.max(1, Number(e.target.value) || 1) })} />
                </label>
                <button className="btn btn--ghost btn--sm" onClick={onRunHealthCheck}><IconRefresh size={13} /> 立即检测</button>
                {settings.healthMonitor.lastRunAt > 0 && (
                  <p className="hint">上次检测：{new Date(settings.healthMonitor.lastRunAt).toLocaleString('zh-CN')}，发现 {settings.healthMonitor.deadIds.length} 个死链</p>
                )}
              </>
            )}

            {tab === 'archive' && (
              <>
                <h3>分层存储</h3>
                <p className="hint">把长期未访问的冷书签标记为归档，便于整理；归档书签仍可在全部书签里浏览（卡片带「归档」标记），随时一键取回。为跨设备一致，归档书签同样占用 sync 配额，本机 local 另存一份副本兜底。</p>
                <label className="field">
                  <span>自动归档：超过多少天未访问（0 = 关闭自动归档）</span>
                  <input type="number" min={0} value={settings.archive.idleDays} onChange={(e) => patchArchive({ idleDays: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
                <div className="archive-actions">
                  <button className="btn btn--primary btn--sm" onClick={() => onRunArchive(settings.archive.idleDays || 180)} disabled={settings.archive.idleDays <= 0}>按当前设置归档</button>
                  <button className="btn btn--ghost btn--sm" onClick={onUnarchiveAll} disabled={archivedCount === 0}>取回全部归档（{archivedCount}）</button>
                </div>
                {settings.archive.lastRunAt > 0 && <p className="hint">上次归档：{new Date(settings.archive.lastRunAt).toLocaleString('zh-CN')}</p>}
              </>
            )}

            {tab === 'shortcuts' && (
              <>
                <h3>快捷键自定义</h3>
                <p className="hint">点击右侧按键后直接按下新组合键（支持 Mod/Alt/Shift）。Mod = ⌘（Mac）或 Ctrl（Win）。</p>
                <div className="shortcut-editor">
                  {SHORTCUT_ACTIONS.map((a) => {
                    const combo = settings.shortcuts[a.id] ?? a.default;
                    return (
                      <div key={a.id} className="shortcut-edit-row">
                        <span>{a.label}</span>
                        <button
                          className={`keycap ${recording === a.id ? 'is-recording' : ''}`}
                          onKeyDown={(e) => {
                            e.preventDefault();
                            // 阻断冒泡：否则录制 Mod+K 等组合键时，App 的全局 window keydown
                            // 会同时执行对应动作（打开快速切换面板/搜索等）。
                            e.stopPropagation();
                            // Escape 取消录制，不写入绑定
                            if (e.key === 'Escape') { setRecording(null); return; }
                            const combo2 = keyComboFromEvent(e);
                            if (!combo2) return;
                            onPatch({ shortcuts: { ...settings.shortcuts, [a.id]: combo2 } });
                            setRecording(null);
                          }}
                          onClick={() => setRecording(recording === a.id ? null : a.id)}
                          tabIndex={recording === a.id ? 0 : -1}
                          autoFocus={recording === a.id}
                        >
                          {recording === a.id ? '按下组合键…' : combo}
                        </button>
                      </div>
                    );
                  })}
                  <button className="btn btn--ghost btn--sm" onClick={() => onPatch({ shortcuts: {} })}>恢复默认</button>
                </div>
              </>
            )}

            {tab === 'privacy' && (
              <>
                <h3>私密分组</h3>
                <p className="hint">把分组标记为私密后，需要输入 PIN 才能查看其中的书签。PIN 仅做轻量哈希，用于防止他人误看，不是安全级加密。</p>
                <label className="field">
                  <span>{settings.pinHash ? '修改 PIN' : '设置 PIN'}</span>
                  <input type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} placeholder="输入 4-12 位 PIN" />
                </label>
                <div className="archive-actions">
                  <button className="btn btn--primary btn--sm" disabled={pinInput.length < 4} onClick={() => { onSetPin(hashPin(pinInput)); setPinInput(''); }}>
                    {settings.pinHash ? '更新 PIN' : '设置 PIN'}
                  </button>
                  {settings.pinHash && <button className="btn btn--ghost btn--sm" onClick={() => { onSetPin(undefined); setPinInput(''); }}>取消 PIN</button>}
                </div>
                <p className="hint hint--foot">设置 PIN 后，在分组设置里可把单个分组标记为私密。</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
