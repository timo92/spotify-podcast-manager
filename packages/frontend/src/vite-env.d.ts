/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the Spotify Web Playback SDK; a fake is used by `pnpm dev:demo`. */
  readonly VITE_SPOTIFY_SDK_URL?: string;
}
