import { useEffect, useRef, useState } from 'react';
import { t, uiLocale } from '../lib/i18n';
import { domainOf } from '../lib/url';
import type { BatchItem } from '../lib/types';

const dateFormatter = new Intl.DateTimeFormat(uiLocale(), {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function formatAdded(addedAt: number): string {
  if (!addedAt) return t('articleAddedUnknown');
  const days = Math.floor((Date.now() - addedAt) / 86_400_000);
  if (days <= 0) return t('articleAddedToday');
  if (days === 1) return t('articleAddedYesterday');
  if (days < 30) return t('articleAddedDays', [days]);
  if (days < 365) return t('articleAddedMonths', [Math.floor(days / 30)]);
  return t('articleAddedOn', [dateFormatter.format(new Date(addedAt))]);
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
          <span>{domainOf(item.url) || t('articleUnknownSource')}</span>
          <span className="card__meta-dot">
            {t('articleEstimatedMinutes', [item.estimatedMinutes])}
          </span>
          <span className="card__meta-dot">{formatAdded(item.addedAt)}</span>
          {item.status === 'invalid' && (
            <span className="card__meta-dot">{t('articleInvalid')}</span>
          )}
          {item.status === 'abandoned' && (
            <span className="card__meta-dot">{t('articleAbandoned')}</span>
          )}
        </div>
      </div>
      <div className="card__actions">
        {item.status !== 'invalid' && item.status !== 'abandoned' && (
          <button className="btn" onClick={() => onOpen(item)} disabled={busy}>
            {item.status === 'read' ? t('articleOpenAgain') : t('articleOpen')}
          </button>
        )}
        {isActionable && (
          <>
            <button
              className={`btn btn--danger${confirming ? ' btn--danger-armed' : ''}`}
              onClick={handleAbandon}
              disabled={busy}
              title={t('articleAbandonTitle')}
            >
              {confirming ? t('articleConfirmAbandon') : t('articleAbandon')}
            </button>
            <button className="btn btn--primary" onClick={() => onMarkRead(item)} disabled={busy}>
              {t('articleMarkRead')}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
