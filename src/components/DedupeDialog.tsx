import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bookmark, Group } from '../types';
import {
  findDuplicateGroups, mergedKeepPatch, scoreBookmarkForKeep,
  type DuplicateGroup,
} from '../lib/features';
import { relativeTime } from '../lib/utils';
import { useModalFocus } from '../lib/useModalFocus';
import { IconClose, IconMerge, IconCheck, IconAlert } from './Icons';

/** 一次合并操作：保留 keepId，把 removeIds 并入其元数据后软删 */
export interface DedupeOperation {
  keepId: string;
  removeIds: string[];
  patch: Partial<Bookmark>;
}

interface Props {
  open: boolean;
  bookmarks: Bookmark[];
  groups: Group[];
  onClose: () => void;
  /** 一次性提交全部合并操作；调用方负责单一撤销快照 */
  onApply: (operations: DedupeOperation[]) => void;
}

/**
 * 逐组审阅式去重对话框。
 * 与旧的「一键删最早」不同：按 URL 指纹归组，展示每条的信息完整度与差异，
 * 默认选中推荐保留项但允许改写，合并时把标签/备注/访问数等元数据并入保留项。
 */
export default function DedupeDialog({ open, bookmarks, groups, onClose, onApply }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef, onClose);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** 每组当前选中的保留项 id；key 为指纹，值为书签 id */
  const [choices, setChoices] = useState<Record<string, string>>({});

  const duplicates = useMemo(
    () => (open ? findDuplicateGroups(bookmarks) : []),
    [open, bookmarks],
  );

  // 关闭即清空；打开/数据变化时保留仍存在组的用户选择，只为新组填推荐、清理已消失的组。
  // 这样逐组合并后不会抹掉用户为其它组手动改过的保留项。
  useEffect(() => {
    if (!open) {
      setChoices({});
      setCollapsed(new Set());
      return;
    }
    const keys = new Set(duplicates.map((g) => g.key));
    setChoices((prev) => Object.fromEntries(duplicates.map((g) => [
      g.key, prev[g.key] && keys.has(g.key) ? prev[g.key] : g.recommendedId,
    ])));
    setCollapsed((prev) => new Set([...prev].filter((k) => keys.has(k))));
  }, [open, duplicates]);

  if (!open) return null;

  const groupName = (id: string | null) => {
    if (!id) return '未分组';
    return groups.find((g) => g.id === id)?.name ?? '未知分组';
  };

  const activeCount = duplicates.filter((g) => !collapsed.has(g.key)).length;
  const totalRemovable = duplicates.reduce((sum, g) => sum + g.removableCount, 0);
  const totalGroups = duplicates.length;

  const buildOperation = (g: DuplicateGroup): DedupeOperation | null => {
    const keepId = choices[g.key] ?? g.recommendedId;
    const keep = g.members.find((m) => m.bookmark.id === keepId)?.bookmark;
    if (!keep) return null;
    const removeIds = g.members.map((m) => m.bookmark.id).filter((id) => id !== keepId);
    if (!removeIds.length) return null;
    const patch = mergedKeepPatch(keep, removeIds
      .map((id) => g.members.find((m) => m.bookmark.id === id)?.bookmark)
      .filter((b): b is Bookmark => Boolean(b)));
    return { keepId, removeIds, patch };
  };

  const applyOne = (g: DuplicateGroup) => {
    const op = buildOperation(g);
    if (!op) return;
    onApply([op]);
    setCollapsed((prev) => new Set(prev).add(g.key));
  };

  const applyAll = () => {
    const ops = duplicates
      .filter((g) => !collapsed.has(g.key))
      .map(buildOperation)
      .filter((op): op is DedupeOperation => Boolean(op));
    if (ops.length) onApply(ops);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={modalRef}
        tabIndex={-1}
        className="modal modal--wide dedupe-modal"
        role="dialog"
        aria-modal="true"
        aria-label="智能去重"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="modal__title">
            <IconMerge size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />智能去重
            <span className="modal__count">{totalGroups} 组</span>
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button>
        </div>

        <div className="modal__body dedupe-body">
          {totalGroups === 0 ? (
            <div className="dedupe-empty">
              <IconCheck size={22} />
              <strong>没有发现重复书签</strong>
              <span>已按网址指纹检查协议、www、追踪参数与尾斜杠差异。</span>
            </div>
          ) : (
            <>
              <div className="dedupe-summary">
                <IconAlert size={14} />
                <span>发现 <b>{totalGroups}</b> 组重复，可清理 <b>{totalRemovable}</b> 条。合并会保留所选书签，并把其余书签的标签、备注与访问数并入，被清理的条目进入回收站可撤销。</span>
              </div>

              <div className="dedupe-toolbar">
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(duplicates.map((g) => g.key)))}
                >
                  {collapsed.size ? `展开全部（${totalGroups - collapsed.size} 组待处理）` : '收起全部'}
                </button>
                <span className="dedupe-progress">已处理 {totalGroups - activeCount}/{totalGroups}</span>
              </div>

              {duplicates.map((g, index) => {
                const isCollapsed = collapsed.has(g.key);
                const chosen = choices[g.key] ?? g.recommendedId;
                const keep = g.members.find((m) => m.bookmark.id === chosen);
                return (
                  <section key={g.key} className={`dedupe-group${isCollapsed ? ' is-done' : ''}`}>
                    <div className="dedupe-group__head">
                      <div className="dedupe-group__title">
                        <span className="dedupe-group__index">{index + 1}</span>
                        <div>
                          <strong title={g.url}>{keep?.bookmark.title ?? g.host}</strong>
                          <span>{g.host} · {g.members.length} 条重复</span>
                        </div>
                      </div>
                      {isCollapsed ? (
                        <span className="dedupe-done"><IconCheck size={13} /> 已合并</span>
                      ) : (
                        <button className="btn btn--primary btn--sm" onClick={() => applyOne(g)}>
                          <IconMerge size={13} /> 合并本组（清掉 {g.removableCount} 条）
                        </button>
                      )}
                    </div>

                    {!isCollapsed && (
                      <>
                        <div className="dedupe-members">
                          {g.members.map((m) => {
                            const bm = m.bookmark;
                            const isKeep = bm.id === chosen;
                            const isRecommended = bm.id === g.recommendedId;
                            return (
                              <label key={bm.id} className={`dedupe-member${isKeep ? ' is-keep' : ''}`}>
                                <input
                                  type="radio"
                                  name={`keep-${g.key}`}
                                  checked={isKeep}
                                  onChange={() => setChoices((prev) => ({ ...prev, [g.key]: bm.id }))}
                                />
                                <div className="dedupe-member__main">
                                  <div className="dedupe-member__line">
                                    <strong title={bm.title}>{bm.title}</strong>
                                    {isRecommended && <span className="dedupe-badge">推荐</span>}
                                    {isKeep && <span className="dedupe-badge dedupe-badge--keep">保留</span>}
                                  </div>
                                  <span className="dedupe-member__url" title={bm.url}>{bm.url}</span>
                                  <div className="dedupe-member__meta">
                                    <span>{groupName(bm.groupId)}</span>
                                    <span>{relativeTime(bm.createdAt)}收藏</span>
                                    {bm.visits > 0 && <span>访问 {bm.visits} 次</span>}
                                    {bm.description?.trim() && <span>有备注</span>}
                                    {bm.tags.length > 0 && <span>{bm.tags.length} 个标签</span>}
                                  </div>
                                  {m.reasons.length > 0 && (
                                    <div className="dedupe-member__reasons">保留优势：{m.reasons.join('、')}</div>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                        {keep && (
                          <div className="dedupe-merge-preview">
                            <IconMerge size={12} /> 合并后：{scoreBookmarkForKeep(keep.bookmark).score} 分保留项
                            {keep.bookmark.tags.length > 0 && ` · 标签 ${keep.bookmark.tags.join('、')}`}
                            {keep.bookmark.description?.trim() && ' · 备注已保留'}
                          </div>
                        )}
                      </>
                    )}
                  </section>
                );
              })}
            </>
          )}
        </div>

        {totalGroups > 0 && (
          <div className="modal__foot">
            <span className="dedupe-foot-note">被清理条目 6 秒内可撤销，也可从回收站还原</span>
            <button className="btn btn--ghost" onClick={onClose}>稍后处理</button>
            <button className="btn btn--primary" onClick={applyAll} disabled={activeCount === 0}>
              <IconMerge size={14} /> 按当前选择全部合并
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
