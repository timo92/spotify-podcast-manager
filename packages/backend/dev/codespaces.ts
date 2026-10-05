/** Port of the Vite dev server (packages/frontend/vite.config.ts), the only port a codespace forwards. */
const UI_PORT = 5173;

/**
 * The public URL of the UI when running in GitHub Codespaces, e.g.
 * https://<codespace>-5173.app.github.dev; undefined elsewhere. The API
 * builds its login redirect from it, since behind the port forwarding the
 * request's host may be the container's localhost.
 */
export function codespacesPublicUrl(env: Record<string, string | undefined>): string | undefined {
  const name = env.CODESPACE_NAME;
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  return name && domain ? `https://${name}-${UI_PORT}.${domain}` : undefined;
}
