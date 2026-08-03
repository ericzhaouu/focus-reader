import { useEffect, useRef, useState } from 'react';
import { domainOf } from '../lib/url';
import type { BatchItem } from '../lib/types';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function formatAdded(addedAt: number): string {
  if (!addedAt) return '收藏时间未知';
  const days = Math.floor((Date.now() - addedAt) / 86_400_000);
  if (days <= 0) return '今天收藏';
  if (days === 1) return '昨天收藏';
  if (days < 30) return `${days} 天前收藏`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前收藏`;
  return `收藏于 ${dateFormatter.format(new Date(addedAt))}`;
}

const STATUS_GLYPH: Record<BatchItem['status'], string> = {
  unread: '',
  read: '✓',
  abandoned: '✕',
  invalid: '–',
};

interface Props {
  item: BatchItem;
  index: number;
  busy: boolean;
  onOpen: (item: BatchItem) => void;
  onMarkRead: (item: BatchItem) => void;
  onAbandon: (item: BatchItem) => void;
}

export default function ArticleCard({ item, index, busy, onOpen, onMarkRead, onAbandon }: Props) {
  // Abandoning deletes the bookmark for good, so the button asks twice.
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handleAbandon = (): void => {
    window.clearTimeout(timer.current);
    if (!confirming) {
      setConfirming(true);
      timer.current = window.setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setConfirming(false);
    onAbandon(item);
  };

  const isActionable = item.status === 'unread';

  return (
    <article className={`card card--${item.status}`}>
      <div className="card__index">{STATUS_GLYPH[item.status] || index + 1}</div>
      <div className="card__body">
        <h2 className="card__title">{item.title}</h2>
        <div className="card__meta">
          <span>{domainOf(item.url) || '未知来源'}</span>
          <span className="card__meta-dot">约 {item.estimatedMinutes} 分钟</span>
          <span className="card__meta-dot">{formatAdded(item.addedAt)}</span>
          {item.status === 'invalid' && <span className="card__meta-dot">已不在待读文件夹中</span>}
          {item.status === 'abandoned' && <span className="card__meta-dot">已放弃，收藏已删除</span>}
        </div>
      </div>
      <div className="card__actions">
        {item.status !== 'invalid' && item.status !== 'abandoned' && (
          <button className="btn" onClick={() => onOpen(item)} disabled={busy}>
            {item.status === 'read' ? '再看一次' : '打开'}
          </button>
        )}
        {isActionable && (
          <>
            <button
              className={`btn btn--danger${confirming ? ' btn--danger-armed' : ''}`}
              onClick={handleAbandon}
              disabled={busy}
              title="从收藏夹中彻底删除这篇文章，不可撤销"
            >
              {confirming ? '确定放弃？' : '放弃'}
            </button>
            <button className="btn btn--primary" onClick={() => onMarkRead(item)} disabled={busy}>
              已读
            </button>
          </>
        )}
      </div>
    </article>
  );
}
