import {
  MILESTONES,
  clearedMilestones,
  equivalenceFor,
  formatScore,
  formatWords,
  stageNumber,
} from '../lib/equivalence';
import type { Stats } from '../lib/types';

const SEGMENTS = 24;

/** Spine colours cycle so a filling shelf reads as a collection, not a gradient. */
const SPINE_COLOURS = [
  '#ff3ba7',
  '#34e6f2',
  '#ffc63d',
  '#4dff9f',
  '#a06bff',
  '#ff7a45',
];

function Meter({ ratio }: { ratio: number }) {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * SEGMENTS);
  return (
    <div className="arcade__meter" role="progressbar" aria-valuenow={Math.round(ratio * 100)}>
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const on = i < filled;
        const tip = on && i === filled - 1;
        return (
          <div
            key={i}
            className={`arcade__seg${on ? ' arcade__seg--on' : ''}${tip ? ' arcade__seg--tip' : ''}`}
          />
        );
      })}
    </div>
  );
}

/**
 * The full shelf, cleared and uncleared alike.
 *
 * Showing only what you have finished hides the thing that actually motivates —
 * the empty slots. Height is scaled by the book's length, so the shelf also shows
 * at a glance that the later ones are harder won.
 */
function Shelf({ totalWords }: { totalWords: number }) {
  const clearedCount = clearedMilestones(totalWords).length;
  const last = Math.max(1, MILESTONES.length - 1);

  return (
    <div className="arcade__spines">
      {MILESTONES.map((milestone, i) => {
        const cleared = i < clearedCount;
        const current = i === clearedCount;
        // Height climbs with the stage rather than the raw word count: the counts
        // span two orders of magnitude, so scaling by them flattens the shelf.
        const height = 15 + Math.round((i / last) * 34);
        return (
          <div
            key={milestone.title}
            className={
              'arcade__spine' +
              (cleared ? '' : ' arcade__spine--empty') +
              (current ? ' arcade__spine--current' : '')
            }
            style={{
              height: `${height}px`,
              ...(cleared
                ? {
                    ['--spine' as string]: SPINE_COLOURS[i % SPINE_COLOURS.length],
                    animationDelay: `${Math.min(i, 8) * 35}ms`,
                  }
                : {}),
            }}
            title={`${milestone.title} · ${formatWords(milestone.words)}${cleared ? ' · 已通关' : ''}`}
          />
        );
      })}
    </div>
  );
}

/**
 * The reading total, rendered as an arcade cabinet screen.
 *
 * A word count is forgettable; "you cleared 《活着》" is not. The milestones become
 * stages, the meter gives immediate feedback on the current one, and the shelf
 * accumulates across months so there is something to look back at.
 */
export default function StatsPanel({ stats }: { stats: Stats }) {
  const progress = equivalenceFor(stats.totalWords);
  const started = stats.totalWords > 0;

  const stageLabel = progress.loops > 0
    ? `LOOP ${progress.loops + 1} · STAGE ${String(stageNumber(stats.totalWords)).padStart(2, '0')}`
    : `STAGE ${String(stageNumber(stats.totalWords)).padStart(2, '0')}`;

  const heading = progress.achieved
    ? progress.loops > 0
      ? `已通关 ${progress.loops} 遍《战争与和平》`
      : `已通关${progress.achieved.title}`
    : '尚未通关第一本';

  const nextLine = progress.next
    ? <>再读 {formatWords(progress.remaining)} 解锁 <em>{progress.next.title}</em></>
    : <>再读 {formatWords(progress.remaining)} 进入下一轮</>;

  return (
    <>
      <section className={`arcade${started ? '' : ' arcade--idle'}`}>
        <div className="arcade__hud">
          <div>
            <div className="arcade__stage">{stageLabel}</div>
            <div className="arcade__title">{heading}</div>
          </div>
          <div className="arcade__readout">
            <div className="arcade__label">score</div>
            <div className="arcade__score">{formatScore(stats.totalWords)}</div>
            {stats.streakDays > 0 && (
              <div className="arcade__combo">COMBO ×{stats.streakDays}</div>
            )}
          </div>
        </div>

        <Meter ratio={progress.ratio} />
        <div className="arcade__meterFoot">
          <span className="arcade__pct">{Math.round(progress.ratio * 100)}%</span>
          <span className="arcade__next">
            {started ? nextLine : <span className="arcade__coin">▶ 读完第一篇即可启动</span>}
          </span>
        </div>

        <div className="arcade__shelf">
          <div className="arcade__shelfHead">
            <span className="arcade__label">cleared</span>
            <span className="arcade__label">
              {clearedMilestones(stats.totalWords).length} / {MILESTONES.length}
            </span>
          </div>
          <Shelf totalWords={stats.totalWords} />
        </div>
      </section>

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
