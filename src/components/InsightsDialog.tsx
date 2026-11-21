import { useRef } from 'react';
import type { Bookmark } from '../types';
import { computeInsights } from '../lib/features';
import { useModalFocus } from '../lib/useModalFocus';
import { IconClose, IconChart } from './Icons';

interface Props {
  open: boolean;
  bookmarks: Bookmark[];
  onClose: () => void;
}

export default function InsightsDialog({ open, bookmarks, onClose }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, modalRef, onClose);
  if (!open) return null;
  const data = computeInsights(bookmarks);
  const maxDomain = Math.max(1, ...data.domains.map((d) => d.count));
  const maxTag = Math.max(1, ...data.tags.map((t) => t.count));
  const maxTrend = Math.max(1, ...data.trends.map((t) => t.count));

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div ref={modalRef} tabIndex={-1} className="modal modal--wide" role="dialog" aria-modal="true" aria-label="数据洞察" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2 className="modal__title"><IconChart size={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />数据洞察</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose size={18} /></button>
        </div>
        <div className="modal__body">
          <div className="ins-stats">
            <div className="ins-stat"><strong>{data.total}</strong><span>书签总数</span></div>
            <div className="ins-stat"><strong>{data.grouped}</strong><span>已分组</span></div>
            <div className="ins-stat"><strong>{data.tagged}</strong><span>已打标签</span></div>
            <div className="ins-stat"><strong>{data.totalVisits}</strong><span>总访问次数</span></div>
          </div>

          <section className="ins-section">
            <h3>域名分布 Top 12</h3>
            {data.domains.length === 0 ? <p className="hint">暂无数据</p> : (
              <div className="ins-bars">
                {data.domains.map((d) => (
                  <div key={d.domain} className="ins-bar">
                    <span className="ins-bar__label" title={d.domain}>{d.domain}</span>
                    <span className="ins-bar__track"><span className="ins-bar__fill" style={{ width: `${(d.count / maxDomain) * 100}%` }} /></span>
                    <em>{d.count}</em>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="ins-section">
            <h3>标签分布 Top 12</h3>
            {data.tags.length === 0 ? <p className="hint">暂无数据</p> : (
              <div className="ins-chips">
                {data.tags.map((t) => (
                  <span key={t.tag} className="ins-chip" style={{ flexGrow: t.count / maxTag }}>{t.tag} · {t.count}</span>
                ))}
              </div>
            )}
          </section>

          {data.trends.length > 0 && (
            <section className="ins-section">
              <h3>收藏趋势（近 12 个月）</h3>
              <div className="ins-trend">
                {data.trends.map((t) => (
                  <div key={t.month} className="ins-trend__col" title={`${t.month}: ${t.count} 个`}>
                    <span className="ins-trend__bar" style={{ height: `${(t.count / maxTrend) * 100}%` }} />
                    <small>{t.month.slice(2)}</small>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.topVisited.length > 0 && (
            <section className="ins-section">
              <h3>最常访问 Top 10</h3>
              <ol className="ins-top">
                {data.topVisited.map((b) => (
                  <li key={b.id}><span>{b.title}</span><em>{b.visits} 次</em></li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
