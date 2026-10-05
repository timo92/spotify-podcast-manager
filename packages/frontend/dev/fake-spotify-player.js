// Fake Spotify Web Playback SDK for `pnpm dev:demo`.
//
// Implements the parts of window.Spotify.Player the app uses and mirrors the
// playback state of the fake Spotify in the backend dev server
// (/api/__fake/player), the same way the real SDK follows Spotify.
(() => {
  const STATE_URL = '/api/__fake/player';

  async function control(action, positionMs) {
    await fetch(STATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, positionMs }),
    });
  }

  class Player {
    constructor(options) {
      this.options = options;
      this.listeners = {};
    }
    addListener(event, cb) {
      (this.listeners[event] ??= []).push(cb);
      return true;
    }
    emit(event, data) {
      (this.listeners[event] ?? []).forEach((cb) => cb(data));
    }
    async connect() {
      this.options.getOAuthToken(() => {});
      setTimeout(() => this.emit('ready', { device_id: 'fake-browser-device' }), 100);
      return true;
    }
    disconnect() {}
    async getCurrentState() {
      const s = await (await fetch(STATE_URL)).json();
      if (!s.episodeId) return null;
      return {
        paused: s.paused,
        position: s.positionMs,
        duration: s.durationMs,
        track_window: {
          current_track: { id: s.episodeId, uri: `spotify:episode:${s.episodeId}`, name: '', type: 'episode' },
        },
      };
    }
    togglePlay() {
      return control('toggle');
    }
    pause() {
      return control('pause');
    }
    async resume() {
      const state = await this.getCurrentState();
      if (state?.paused) await control('toggle');
    }
    seek(positionMs) {
      return control('seek', positionMs);
    }
    activateElement() {
      return Promise.resolve();
    }
  }

  window.Spotify = { Player };
  window.onSpotifyWebPlaybackSDKReady?.();
})();
