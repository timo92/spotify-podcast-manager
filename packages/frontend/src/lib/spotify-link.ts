/**
 * Where links to Spotify open. On a touch device the Spotify app takes the
 * link over, so a new tab would stay behind empty: the link opens in place
 * (without the app, Spotify's web page replaces the web app until Back).
 * Elsewhere it opens in a new tab, so the web app and its browser player stay.
 */
export function spotifyLinkTarget(): '_self' | '_blank' {
  // Missing in jsdom.
  return window.matchMedia?.('(pointer: coarse)').matches ? '_self' : '_blank';
}

/** Opens a link to Spotify, like a click on it would (see spotifyLinkTarget). */
export function openSpotifyLink(url: string) {
  if (spotifyLinkTarget() === '_self') window.open(url, '_self');
  else window.open(url, '_blank', 'noopener');
}
