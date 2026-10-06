# D23 — Notes are individual entries with a position

**Decision.**
- An episode has any number of notes. Each note is its own item
  (`NOTE#<showId>` / `<episodeId>#<noteId>`) with a text, a position in the
  episode (`positionMs`, or null for a note on the whole episode) and the
  time it was written. Notes are created, edited and deleted one by one.
- The notes of an episode are listed by position. *Verlauf → Notizen* shows
  one card per note; search matches single notes, and the period filter and
  the order use the time a note was written, not its last edit.
- A new note gets the position of the browser player from when typing
  started, if it plays the episode. Otherwise the server asks Spotify for the
  playback state (`GET /me/player`, covered by `user-read-playback-state`)
  and uses its position if Spotify is playing this episode on any device. If
  Spotify can't be asked, the note is saved without a position.
- There is no conversion of notes stored as one text per episode. Before V1
  there is no data worth keeping; existing deployments delete their `NOTE#`
  items.

**Why.** Notes are most useful for episodes heard over days or weeks. With
one text per episode, a search found the whole text instead of the thought,
a single line added later moved all of an episode's notes into "this week",
and a timestamp could only be inserted while listening in the browser. Single
notes with a position fix all three, and the position works with the Spotify
app on a phone as well.

**Alternatives.**
- *Keep one text and parse `[mm:ss]` lines into entries for display:* no
  model change, but editing, deleting and dating single entries would depend
  on how the text is formatted.
- *A separate "notes" table or one item per episode holding a list:* a list
  item grows without bound and every edit rewrites all notes of the episode;
  separate items fit the existing single-table layout (D8).
- *Take the position only in the browser:* simpler, but no position for the
  most common way of listening, the Spotify app.
