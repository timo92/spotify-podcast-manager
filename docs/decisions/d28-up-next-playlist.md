# D28 — Episodes play inside an "Up next" playlist the app manages

**Decision.**
- With the setting "Play through a Spotify playlist" on, the app keeps a
  private playlist "Podcast-Cockpit: Up next" in the user's Spotify account.
  It mirrors Today: the episode being started, then the open plan slots, the
  suggestions within the budget and the further ones (`upNextItems` in
  `shared`).
- Every episode the app starts plays inside that playlist (`context_uri` and
  `offset`), so Spotify continues with the next item.
- The content is rebuilt from the current state and replaced as a whole:
  - when an episode is started (always written, which also recreates a
    playlist deleted in Spotify);
  - when Today is loaded, an episode's status changes, or a sync finishes
    (only written when the list changed).

  An episode of the list that plays right now stays first, so a rewrite
  doesn't change what Spotify plays next.
- The app stores the playlist id, the list it last wrote and the time zone
  of the last client (`META/UPNEXT`). The sync builds Today in that time zone.
- While the web app follows playback, it pauses Spotify once an episode of
  the list has ended and one outside the list plays. That is Spotify's
  Autoplay. Spotify still reports the playlist as the context then, so the
  app compares with the list it wrote.
- The playlist permission (`playlist-modify-private`) is asked for at every
  login, but reported as missing only while the setting is on. Without it,
  or when Spotify refuses a playlist call, the app plays single episodes as
  before.

**Why.**
- Started as a single episode, Spotify continues with its Autoplay ("similar
  content"), a seemingly random episode. Autoplay is a setting of each
  Spotify app; the Web API can neither read nor change it, nor set the sleep
  timer.
- A playlist is replaced in one call, so it never accumulates stale items. It
  is also usable without the web app, e.g. in the car.
- Built from the current state rather than the weekly plan, the list stays
  right when the user skips days or catches up by hand.

**Alternatives.**
- *Spotify's queue:* can't be cleared or reordered through the API, so items
  pile up when the user stops early.
- *The show as context:* Spotify continues with the next item of the show's
  listing, the next older episode, which is wrong for news and not reliably
  right for series.
- *Pausing from the server:* a scheduled check could also pause Autoplay with
  the web app closed, at the cost of a Spotify call every minute. Left for
  later, if the pause in the open web app isn't enough.
