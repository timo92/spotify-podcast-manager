import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { EpisodeProgress } from '@podcast/shared';
import { EpisodeSheet } from '../components/EpisodeSheet';
import { Empty, ErrorBox, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatDuration } from '../lib/format';
import { qk } from '../lib/queries';

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}

export function HistoryPage() {
  const history = useQuery({ queryKey: qk.history, queryFn: () => api.history(200) });
  const [open, setOpen] = useState<{ showId: string; episodeId: string } | null>(null);

  const groups: [string, EpisodeProgress[]][] = [];
  for (const p of history.data ?? []) {
    const label = dayLabel(p.listenedAt ?? p.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(p);
    else groups.push([label, [p]]);
  }
  const totalMs = (history.data ?? [])
    .filter((p) => Date.now() - Date.parse(p.listenedAt ?? p.updatedAt) < 7 * 86_400_000)
    .reduce((sum, p) => sum + (p.durationMs ?? 0), 0);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Verlauf</h1>
        <p className="muted">{totalMs > 0 ? `${formatDuration(totalMs)} in den letzten 7 Tagen` : 'Zuletzt gehörte Folgen'}</p>
      </header>
      {history.isLoading && <Spinner />}
      {history.error && <ErrorBox error={history.error} />}
      {history.data?.length === 0 && (
        <Empty title="Noch nichts gehört">Markiere Folgen als gehört – sie erscheinen dann hier.</Empty>
      )}
      {groups.map(([label, items]) => (
        <section key={label} className="section">
          <h2 className="h3">{label}</h2>
          <ul className="simple-list">
            {items.map((p) => (
              <li key={`${p.showId}-${p.episodeId}`}>
                <button type="button" className="linklike" onClick={() => setOpen({ showId: p.showId, episodeId: p.episodeId })}>
                  {p.episodeName ?? p.episodeId}
                </button>
                <span className="muted small">
                  <Link to={`/podcasts/${encodeURIComponent(p.showId)}`}>{p.showName}</Link>
                  {p.durationMs ? ` · ${formatDuration(p.durationMs)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {open && <EpisodeSheet {...open} onClose={() => setOpen(null)} />}
    </div>
  );
}
