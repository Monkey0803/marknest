import {
  IconBookmark, IconClock, IconDownload, IconPlus, IconReadingList,
} from './Icons';

export type EmptyVariant = 'first' | 'recent' | 'reading' | 'filtered';

/** 书签列表的四种空状态：首次使用 / 阅读清单空 / 最近访问空 / 筛选无结果 */
export default function EmptyState({
  variant, onImport, onSaveCurrent, onAdd, onClear, onBrowseAll,
}: {
  variant: EmptyVariant;
  onImport: () => void;
  onSaveCurrent: () => void;
  onAdd: () => void;
  onClear: () => void;
  onBrowseAll: () => void;
}) {
  if (variant === 'reading') {
    return (
      <div className="empty">
        <div className="empty__art"><IconReadingList size={28} /></div>
        <h2>阅读清单是空的</h2>
        <p>把书签卡片操作栏里的「阅读清单」按钮点亮，即可稍后再读；打开链接后会自动移出清单。</p>
        <button className="btn btn--ghost btn--sm" onClick={onBrowseAll}>去看全部书签</button>
      </div>
    );
  }
  if (variant === 'recent') {
    return (
      <div className="empty">
        <div className="empty__art"><IconClock size={28} /></div>
        <h2>还没有访问记录</h2>
        <p>「最近访问」统计的是在 Marknest 里点开过的书签，浏览器地址栏直接访问不会计入。</p>
        <button className="btn btn--ghost btn--sm" onClick={onBrowseAll}>去看全部书签</button>
      </div>
    );
  }
  if (variant === 'filtered') {
    return (
      <div className="empty">
        <div className="empty__art"><IconBookmark size={30} /></div>
        <h2>没有匹配的书签</h2>
        <p>换个关键词，或清除当前的搜索、分组与标签筛选。</p>
        <button className="btn btn--primary btn--sm" onClick={onClear}>清除搜索与筛选</button>
      </div>
    );
  }
  return (
    <div className="empty empty--first">
      <div className="empty__art"><IconBookmark size={30} /></div>
      <h2>把书签搬过来</h2>
      <p>一次性导入 Chrome 里已有的书签，文件夹会原样变成分组；之后用「收藏当前页」随手收新链接。</p>
      <div className="empty__actions">
        <button className="btn btn--primary" onClick={onImport}>
          <IconDownload size={15} /> 导入 Chrome 书签
        </button>
        <button className="btn btn--ghost" onClick={onSaveCurrent}>
          <IconPlus size={15} /> 收藏当前页面
        </button>
        <button className="empty__link" onClick={onAdd}>手动添加一个</button>
      </div>
    </div>
  );
}
