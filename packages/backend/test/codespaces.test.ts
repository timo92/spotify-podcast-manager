import { describe, expect, it } from 'vitest';
import { codespacesPublicUrl } from '../dev/codespaces.js';

describe('codespacesPublicUrl', () => {
  it('builds the forwarded URL of the UI from the Codespaces environment', () => {
    expect(
      codespacesPublicUrl({ CODESPACE_NAME: 'fluffy-space-abc123', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' }),
    ).toBe('https://fluffy-space-abc123-5173.app.github.dev');
  });

  it('is undefined outside Codespaces', () => {
    expect(codespacesPublicUrl({})).toBeUndefined();
    expect(codespacesPublicUrl({ CODESPACE_NAME: 'x' })).toBeUndefined();
  });
});
