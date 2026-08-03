import { equivalenceFor, formatWords } from '../lib/equivalence';
import type { Stats } from '../lib/types';

/**
 * Running apps turn kilometres into bowls of rice because a raw number is
 * forgettable and "you burned a meal" is not. The same trick applies to reading:
 * word counts mean little, "you have read a novel's worth" means a lot.
 */
function Equivalence({ totalWords }: { totalWords: number }) {
  const progress = equivalenceFor(totalWords);
  const percent = Math.round(Math.min(1, Math.max(0, progress.ratio)) * 100);

  const headline = progress.achieved
    ? progress.loops > 0
      ? `已读完 ${progress.loops} 遍《战争与和平》的量`
      : `相当于读完了${progress.achieved.title}`
    : '还没有攒够第一个里程碑';

  const footnote = progress.next
    ? `再读 ${formatWords(progress.remaining)}，就相当于读完${progress.next.title}`
    : `再读 ${formatWords(progress.remaining)}，就又是一遍《战争与和平》`;

  return (
    <section className="equiv">
      <div className="equiv__top">
        <div>
          <div className="equiv__headline">{headline}</div>
          <div className="equiv__total">累计 {formatWords(totalWords)}</div>
        </div>
        <div className="equiv__badge">{progress.achieved ? '📖' : '🌱'}</div>
      </div>
      <div className="equiv__bar">
        <div className="equiv__fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="equiv__foot">{footnote}</div>
    </section>
  );
}

export default function StatsPanel({ stats }: { stats: Stats }) {
  return (
    <>
      <Equivalence totalWords={stats.totalWords} />
      <div className="stats">
        <div className="stat">
          <div className="stat__value">{stats.totalRead}</div>
          <div className="stat__label">累计读完</div>
        </div>
        <div className="stat">
          <div className="stat__value">{stats.streakDays}</div>
          <div className="stat__label">连续阅读天数</div>
        </div>
        <div className="stat">
          <div className="stat__value">{stats.batchesCompleted}</div>
          <div className="stat__label">完成批次</div>
        </div>
        <div className="stat">
          <div className="stat__value">{stats.totalAbandoned}</div>
          <div className="stat__label">主动放弃</div>
        </div>
      </div>
    </>
  );
}
