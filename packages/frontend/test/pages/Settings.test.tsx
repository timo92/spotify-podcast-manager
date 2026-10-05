import { screen } from '@testing-library/react';
import type { AppStatus } from '@podcast/shared';
import { describe, expect, it, vi } from 'vitest';
import i18n from '../../src/i18n';
import { api } from '../../src/lib/api';
import { SettingsPage } from '../../src/pages/Settings';
import { settings } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

const status: AppStatus = {
  configured: true,
  authenticated: true,
  redirectUri: 'https://podcasts.example.com/api/auth/callback',
  claimed: true,
  spotifyConnected: true,
  user: { id: 'owner', displayName: 'Owner' },
  sync: { status: 'idle', showsSynced: 5, showsFailed: 0, newEpisodes: 2 },
  grantedScopes: [],
  missingScopes: [],
};

describe('SettingsPage', () => {
  it('switches the language and remembers it in this browser', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue(settings);
    vi.spyOn(api, 'status').mockResolvedValue(status);
    const { user } = renderWithProviders(<SettingsPage />);

    expect(await screen.findByRole('heading', { name: 'Einstellungen' })).toBeInTheDocument();
    expect(screen.getByText(/5 Podcasts synchronisiert, 2 neue Folgen\./)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'English' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText(/5 podcasts synced, 2 new episodes\./)).toBeInTheDocument();
    expect(localStorage.getItem('pm.lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    // "Automatisch" follows the browser again (English in jsdom) and forgets the choice.
    await user.click(screen.getByRole('radio', { name: 'Automatic' }));
    expect(localStorage.getItem('pm.lang')).toBeNull();
    expect(i18n.language).toBe('en');
  });
});
