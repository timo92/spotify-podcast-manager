// Minimal typings for the Spotify Web Playback SDK (https://sdk.scdn.co/spotify-player.js).
declare namespace Spotify {
  interface PlaybackState {
    paused: boolean;
    position: number;
    duration: number;
    track_window: { current_track: { id: string | null; uri: string; name: string; type: string } | null };
  }
  interface ErrorPayload {
    message: string;
  }
  class Player {
    constructor(options: { name: string; getOAuthToken: (cb: (token: string) => void) => void; volume?: number });
    connect(): Promise<boolean>;
    disconnect(): void;
    addListener(event: 'ready' | 'not_ready', cb: (data: { device_id: string }) => void): boolean;
    addListener(event: 'player_state_changed', cb: (state: PlaybackState | null) => void): boolean;
    addListener(
      event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error' | 'autoplay_failed',
      cb: (e: ErrorPayload) => void,
    ): boolean;
    getCurrentState(): Promise<PlaybackState | null>;
    togglePlay(): Promise<void>;
    pause(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    activateElement(): Promise<void>;
  }
}

interface Window {
  onSpotifyWebPlaybackSDKReady?: () => void;
  Spotify?: typeof Spotify;
}
