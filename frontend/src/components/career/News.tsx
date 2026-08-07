import { useEffect, useState } from "react";
import { fetchNews } from "../../game/careerApi";
import type { NewsItemDTO } from "../../game/careerTypes";
import "./career.css";

interface Props {
  saveId: number;
  onBack: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  manager: "MANAGER",
  retirement: "RETIREMENT",
};

/**
 * A persistent, season-by-season feed — what ClubHome's own "just
 * happened" banners (managerial changes, retirements) show ephemerally
 * right after advancing, this screen shows permanently, browsable any
 * time. Both read from the exact same events: `advance-season` and
 * POST /api/players/:id/retire write a news_items row (see db.ts's own
 * comment) alongside whatever else they already do, so a news item can
 * never exist without the underlying event actually having happened.
 * Deliberately NOT a replacement for the banners — those still surface
 * the human's own pending retirement DECISIONS (Keep/Let go), which a
 * passive read-only feed like this one has no way to act on.
 */
export function News({ saveId, onBack }: Props) {
  const [items, setItems] = useState<NewsItemDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchNews(saveId)
      .then(setItems)
      .catch((e) => setError(String(e.message ?? e)));
  }, [saveId]);

  // Backend already orders season DESC, id DESC — grouping here just
  // splits that single ordered list into per-season sections without
  // re-sorting anything.
  const seasons: { season: number; items: NewsItemDTO[] }[] = [];
  for (const item of items ?? []) {
    const group = seasons[seasons.length - 1];
    if (group && group.season === item.season) group.items.push(item);
    else seasons.push({ season: item.season, items: [item] });
  }

  return (
    <div className="career-page">
      <div className="career-header">
        <button type="button" className="career-back" onClick={onBack}>
          ← Club
        </button>
        <h1>News</h1>
      </div>
      <p className="career-muted">Managerial changes, retirements, and signings from around the league.</p>

      {error && <p className="career-error">{error}</p>}

      {items === null ? (
        <p>Loading…</p>
      ) : seasons.length === 0 ? (
        <p className="career-empty">No news yet — advance a season to see what happens around the league.</p>
      ) : (
        seasons.map(({ season, items: seasonItems }) => (
          <div key={season} className="career-section">
            <h2>Season {season}</h2>
            <ul className="career-list">
              {seasonItems.map((item) => (
                <li key={item.id} className="career-manager-row">
                  <span className="career-manager-style">{TYPE_LABEL[item.type] ?? item.type.toUpperCase()}</span>
                  <span className="career-manager-name">{item.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
