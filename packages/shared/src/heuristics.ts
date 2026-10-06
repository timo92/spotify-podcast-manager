import { releaseTime } from './logic.js';
import type { ConsumptionMode, Episode } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Guesses a consumption mode for a freshly imported show: shows that publish
 * every few days are treated as news-like (LATEST), everything else as a
 * series to work through (SEQUENTIAL). The user reviews the guess anyway.
 */
export function guessMode(episodes: Pick<Episode, 'releaseDate'>[], text = ''): ConsumptionMode {
  if (/\b(nachrichten|news|daily|täglich|briefing)\b/i.test(text)) return 'LATEST';
  const times = episodes
    .map((e) => releaseTime(e.releaseDate))
    .filter((t) => t > 0)
    .sort((a, b) => b - a)
    .slice(0, 11);
  if (times.length < 5) return 'SEQUENTIAL';
  // Times are sorted newest first, so each gap is the previous time minus this one.
  const gaps = times.slice(1).map((t, i) => ((times[i] ?? t) - t) / DAY_MS);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)] ?? Infinity;
  return median <= 2.5 ? 'LATEST' : 'SEQUENTIAL';
}

const CATEGORY_KEYWORDS: [string, RegExp][] = [
  ['Nachrichten', /nachrichten|\bnews\b|tagesschau|der tag\b|briefing|daily|aktuell|journal/i],
  ['Politik', /politi[ck]|demokratie|wahl|bundestag|regierung|geopoliti/i],
  ['Wirtschaft', /wirtschaft|ökonom|econom|finanz|börse|business|geld|money|markets?\b|invest/i],
  ['Geschichte', /geschicht|histor|vergangenheit|zeitreise/i],
  ['Geographie', /geograph|reise|travel|länder|erdkunde|kontinent|world/i],
  ['Philosophie', /philosoph|denken|ethik|sein und|existenz/i],
  ['Wissenschaft', /wissenschaft|science|forschung|physik|biolog|chemie|astronom|\bwissen\b/i],
  ['Gesellschaft', /gesellschaft|society|kultur|culture|sozial/i],
];

/** Guesses categories from name and description; never returns an empty list. */
export function guessCategories(name: string, description: string, known: string[]): string[] {
  const hits: string[] = [];
  for (const [cat, re] of CATEGORY_KEYWORDS) {
    if (!known.includes(cat)) continue;
    // The name is a much stronger signal than the description.
    if (re.test(name)) hits.unshift(cat);
    else if (re.test(description)) hits.push(cat);
  }
  const unique = [...new Set(hits)].slice(0, 2);
  if (unique.length) return unique;
  return known.includes('Sonstiges') ? ['Sonstiges'] : [];
}
