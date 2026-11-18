import { useEffect, useRef, useState } from 'react';
import type { AppState, Bookmark } from '../types';
import { exportToHtml, getHost, relativeTime } from '../lib/utils';
import { downloadFile } from '../lib/utils';
import { getDiagnostic, type SyncDiagnostic } from '../lib/storage';
import { IconClose, IconDownload, IconUpload, IconSparkle, IconTrash, IconCloudCheck } from './Icons';

interface Props {
  open: boolean;
  state: AppState;
  duplicates: string[];
  onClose: () => void;
  onImportJson: (data: AppState) => void;
  onImportHtml: (bookmarks: Bookmark[]) => void;
  onRemoveDuplicates: (ids: string[]) => void;
  onImportBrowser: () => Promise<{ imported: number; skipped: number; unsupported?: number; groups?: number }>;
}

export default function DataDialog({
  open, state, duplicates, onClose, onImportJson, onImportHtml,
  onRemoveDuplicates, onImportBrowser,
}: Props) {
  const [message, setMessage] = useState('');
  const [permIssue, setPermIssue] = useState<'permission' | 'unknown' | null>(null);
  const [diag, setDiag] = useState<SyncDiagnostic | null>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    getDiagnostic()
      .then((d) => { if (alive) setDiag(d); })
      .catch(() => { if (alive) setDiag(null); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const handleJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as AppState;
      if (!Array.isArray(data.bookmarks)) throw new Error('格式不正确');
      onImportJson(data);
      setMessage(`已导入 ${data.bookmarks.length} 个书签（覆盖当前数据）`);
    } catch {
      setMessage('导入失败：JSON 文件格式不正确');
    }
  };

  const handleHtml = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const links = Array.from(doc.querySelectorAll('a[HREF]'));
      const now = Date.now();
      const items: Bookmark[] = links
        .map((a, i) => {
          const url = a.getAttribute('HREF') || '';
          const title = a.textContent?.trim() || getHost(url);
          let groupId: string | null = null;
          let parent = a.closest('dl')?.previousElementSibling;
          if (parent?.tagName === 'H3') {
            const gname = parent.textContent?.trim() || '';
            groupId = state.groups.find((g) => g.name === gname)?.id ?? null;
          }
          return {
            id: crypto.randomUUID(), title, url, description: '', groupId, tags: [], favicon: '',
            createdAt: now + i, updatedAt: now + i, visitedAt: 0, visits: 0, pinned: false, order: now + i,
          };
        })
        .filter((b) => b.url.startsWith('http'));
      onImportHtml(items);
      setMessage(`已从 HTML 导入 ${items.length} 个书签`);
    } catch {
      setMessage('导入失败：HTML 文件格式不正确');
    }
  };

  const doExportJson = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(JSON.stringify(state, null, 2), `marknest-${stamp}.json`, 'application/json');
    setMessage('已导出 JSON 备份');
  };

  const doExportHtml = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(exportToHtml(state.bookmarks, state.groups), `marknest-${stamp}.html`, 'text/html');
    setMessage('已导出 HTML 书签文件');
  };

  const doImportBrowser = async () => {
    setMessage('正在读取浏览器书签…');
    setPermIssue(null);
    try {
      const { imported, skipped, unsupported = 0, groups: groupCount } = await onImportBrowser();
      const parts = [`已导入浏览器书签 ${imported} 个`];
      if (groupCount) parts.push(`新建 ${groupCount} 个分组（保留文件夹层级）`);
      if (skipped) parts.push(`跳过重复 ${skipped} 个`);
      if (unsupported) parts.push(`忽略 ${unsupported} 个非网页链接`);
      setMessage(parts.join('，'));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const noPermission = /MISSING_BOOKMARKS_PERMISSION|permission|权限|undefined|getTree/i.test(detail);
      setPermIssue(noPermission ? 'permission' : 'unknown');
      setMessage(
        noPermission
          ? '读取浏览器书签失败：扩展还没有「书签」权限'
          : `读取浏览器书签失败：${detail || '未知错误'}`,
      );
    }
  };

  const copyId = async () => {
    if (!diag) return;
    try {
      await navigator.clipboard.writeText(diag.extensionId);
      setMessage('扩展 ID 已复制，可粘贴到另一台设备对比');
    } catch {
      setMessage(`扩展 ID：${diag.extensionId}`);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="数据与整理"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="modal__title">数据与整理</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <IconClose size={18} />
          </button>
        </div>

        <div className="modal__body">
          {message && <div className="notice" role="status">{message}</div>}

          <section className="data-section">
            <h3 className="data-section__title">同步诊断</h3>
            {diag ? (
              <div className="diag-box">
                <div className="diag-row">
                  <span className="diag-row__k">扩展 ID</span>
                  <button className="diag-id" onClick={() => void copyId()} title="点击复制">
                    {diag.extensionId}
                  </button>
                </div>
                <div className="diag-row">
                  <span className="diag-row__k">云端书签</span>
                  <span className="diag-row__v">{state.bookmarks.length} 条 · {diag.bmChunks} 个分片</span>
                </div>
                <div className="diag-row">
                  <span className="diag-row__k">云端分组</span>
                  <span className="diag-row__v">{state.groups.length} 个 · {diag.grChunks} 个分片</span>
                </div>
                <div className="diag-row">
                  <span className="diag-row__k">存储占用</span>
                  <span className="diag-row__v">{(diag.bytes / 1024).toFixed(1)} KB / 100 KB</span>
                </div>
                <div className="diag-row">
                  <span className="diag-row__k">最后写入</span>
                  <span className="diag-row__v">{diag.updatedAt ? relativeTime(diag.updatedAt) : '—'}</span>
                </div>
                {(() => {
                  const pct = Math.min(100, Math.round((diag.bytes / diag.quota) * 100));
                  const warn = pct >= 80;
                  return (
                    <div className="quota">
                      <div className="quota__head">
                        <span>同步容量</span>
                        <span className={warn ? 'quota__pct is-warn' : 'quota__pct'}>{pct}%</span>
                      </div>
                      <div className="quota__track">
                        <div
                          className={`quota__fill ${warn ? 'is-warn' : ''}`}
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                      {warn && (
                        <p className="quota__tip">
                          已用超过 80%，接近 Chrome 同步上限（100 KB）。建议导出 JSON 备份，或清理重复/无用的书签。
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <p className="hint">正在读取同步诊断信息…</p>
            )}
            <div className="diag-tip">
              <IconCloudCheck size={15} />
              <p>
                <strong>跨设备同步的三个前提：</strong>
                ① 两台设备的扩展 ID 必须<strong>完全相同</strong>（用上方 ID 对比）；
                ② Chrome 已登录<strong>同一个 Google 账户</strong>并开启同步；
                ③ 等待 1–2 分钟让 Google 服务器下发变更。ID 不同是最常见的不同步原因。
              </p>
            </div>
          </section>

          <section className="data-section">
            <h3 className="data-section__title">备份与迁移</h3>
            <div className="data-grid">
              <button className="data-action" onClick={doExportJson}>
                <IconDownload size={18} />
                <span>导出 JSON 备份</span>
                <small>完整数据，可再次导入</small>
              </button>
              <button className="data-action" onClick={() => jsonRef.current?.click()}>
                <IconUpload size={18} />
                <span>导入 JSON</span>
                <small>覆盖当前全部数据</small>
              </button>
              <button className="data-action" onClick={doExportHtml}>
                <IconDownload size={18} />
                <span>导出 HTML</span>
                <small>通用书签格式</small>
              </button>
              <button className="data-action" onClick={() => htmlRef.current?.click()}>
                <IconUpload size={18} />
                <span>导入 HTML</span>
                <small>从其他浏览器迁移</small>
              </button>
            </div>
            <input
              ref={jsonRef} type="file" accept="application/json,.json" hidden
              onChange={(e) => { void handleJson(e.target.files?.[0]); e.target.value = ''; }}
            />
            <input
              ref={htmlRef} type="file" accept="text/html,.html" hidden
              onChange={(e) => { void handleHtml(e.target.files?.[0]); e.target.value = ''; }}
            />
          </section>

          <section className="data-section">
            <h3 className="data-section__title">从浏览器导入</h3>
            <button className="btn btn--ghost btn--block" onClick={() => void doImportBrowser()}>
              <IconSparkle size={15} /> 导入 Chrome 现有书签
            </button>
            <p className="hint">读取 Chrome 书签栏与其他书签中的链接，自动跳过已存在的网址。</p>
            {permIssue === 'permission' && (
              <div className="notice notice--warn" role="alert">
                <strong>扩展缺少「书签」权限。</strong>
                <span>
                  打开 <code>chrome://extensions</code> → 找到 Marknest → 点「重新加载」；
                  若是从商店/CRX 安装，需先确认新版权限。重载后再点上面的按钮即可。
                </span>
              </div>
            )}
            {permIssue === 'unknown' && (
              <div className="notice notice--warn" role="alert">
                读取失败。可先在 Chrome 的「书签管理器」里导出 HTML，再用上面的「导入 HTML」迁移。
              </div>
            )}
          </section>

          <section className="data-section">
            <h3 className="data-section__title">重复检测</h3>
            {duplicates.length === 0 ? (
              <p className="hint"><IconSparkle size={13} /> 没有发现重复书签，很整洁。</p>
            ) : (
              <div className="dup-box">
                <p>发现 {duplicates.length} 个重复书签（保留最早添加的一条）。</p>
                <button
                  className="btn btn--danger btn--sm"
                  onClick={() => onRemoveDuplicates(duplicates)}
                >
                  <IconTrash size={14} /> 清理重复项
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
