# D13 — Spotify listening state counts by default

**Decision.** Episodes that Spotify reports as fully played count as heard
unless the user has marked them; the setting can be turned off.

**Why.** The user listens in Spotify. Without this, a series already half
heard in Spotify would start again at episode 1. Explicit marks in the app
always take precedence, and a sync never writes personal progress.
