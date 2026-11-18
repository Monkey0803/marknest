import type { SyncStatus } from '../types';
import { relativeTime } from '../lib/utils';
import { IconCloudCheck, IconCloudOff, IconCloud } from './Icons';

interface Props {
  sync: SyncStatus;
  onRefresh: () => void;
}

export default function SyncBadge({ sync, onRefresh }: Props) {
  const error = sync.phase === 'error';
  const syncing = sync.phase === 'syncing';
  const Icon = error ? IconCloudOff : syncing ? IconCloud : IconCloudCheck;

  return (
    <button
      type="button"
      className={`sync-badge sync-badge--${sync.phase}`}
      onClick={onRefresh}
      title={`${sync.message} · 点击重新同步`}
      aria-label={`同步状态：${sync.message}，点击重新同步`}
    >
      <span className="sync-badge__dot" />
      <Icon size={14} />
      <span className="sync-badge__label">
        {error ? '同步异常' : syncing ? '同步中' : (
          <>
            已同步
            {/* 窄面板里只保留「已同步」，时间戳单独一层便于隐藏 */}
            <span className="sync-badge__time"> · {relativeTime(sync.lastSyncedAt)}</span>
          </>
        )}
      </span>
    </button>
  );
}
