# Requirements → implementation

How the original requirements (in German) map to the MVP, plus where and why
the MVP deviates from them.

| § | Requirement | Status |
| --- | --- | --- |
| 3 | LATEST / SEQUENTIAL / MANUAL | ✅ `packages/shared/src/logic.ts` (`selectNextEpisode`) |
| 4.1 | Spotify OAuth, no password stored, tokens handled securely | ✅ Authorization-code flow. Tokens are kept server-side only; the browser gets a short-lived access token for the in-browser player. |
| 4.2 | Shows and episodes with metadata | ✅ Saved shows plus all episodes, including Spotify's resume point |
| 4.3 | Separate service layer, errors, rate limits, missing permissions | ✅ `spotify/client.ts`, [spotify-api.md](spotify-api.md). The UI shows missing scopes with a "reconnect" button. |
| 5 | Own data store (podcast, episode, progress) | ✅ DynamoDB single table. Progress is stored separately from episode metadata. |
| 6 | "Heute" view | ✅ Recommended (within budget), more episodes, shows with no new episode, recently heard |
| 7 | Podcast overview (name, category, mode, progress, new count, last sync, cover) | ✅ Plus a filter by category or paused, and priority ordering |
| 8 | Detail page: description, filter, search, sort, actions | ✅ Plus "mark all earlier episodes as heard" and "reset to the Spotify state" |
| 9 | Episode view, opening Spotify | ✅ Episode sheet with full description and progress in %. Notes and tags are deferred (later). |
| 10 | Daily budget | ✅ Greedy selection with tolerance. Video budget: later (YouTube). |
| 11 | Free-form categories, several per podcast | ✅ |
| 12 | Sync that never overwrites personal status | ✅ See the note on Spotify's played state below. |
| 13 | YouTube | ⏳ Phase 2. `source` field and swappable integration are prepared. |
| 14 | Mobile and desktop, dark mode, clear status labels | ✅ |
| 15/16 | Priority, pause, skip, pin next episode, change mode/category, remove from "Heute" | ✅ |
| 17 | Privacy: minimal data, delete everything | ✅ Export as JSON plus "delete all data" |
| 18 | No own player | ↔️ See "Changes and additions" below. |

## Changes and additions

- **Built-in player.** You asked for an option to play episodes directly, so the app plays them in the browser via the Web Playback SDK, or on any Spotify Connect device. "Open in Spotify" is always available too. On mobile, where the SDK does not work, opening the Spotify app is the default.
- **Spotify's played state is on by default.** Section 12 says a sync must not mark episodes as heard. The sync still never writes your progress. However, the *view* treats episodes that Spotify reports as fully played as heard. Your own marks always win, and the setting can be switched off. Without it, a series you are halfway through in Spotify would start again at episode 1.
- **SEQUENTIAL continues after the last finished episode**, not at the oldest unheard one. Unmarked episodes before that point are treated as left behind. Gaps are filled once the end is reached. "Mark all earlier as heard" cleans up old episodes in one click.
- **LATEST** suggests the newest episode only. Once you have finished it, yesterday's episode is not suggested again.
- **Auto-classification on import**: shows that publish every ~2 days or less (or have news-like names) start as `LATEST`, and keywords suggest categories. You confirm the guesses in a review screen.
- **New shows are ordered news first**, so time-sensitive episodes get the budget.
- **Setup code**: protects the setup page between `cdk deploy` and your first login.
