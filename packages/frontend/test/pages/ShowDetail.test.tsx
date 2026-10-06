import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../src/lib/api';
import { ShowDetailPage } from '../../src/pages/ShowDetail';
import { episode, settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

describe('ShowDetailPage', () => {
  it('expands the description, also from the keyboard', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue(settings);
    vi.spyOn(api, 'show').mockResolvedValue({
      show: show({ description: 'Geographie zum Hören: Länder, Landschaften und Menschen.' }),
      episodes: [episode(1)],
    });
    vi.spyOn(api, 'schedule').mockResolvedValue({ rules: [] });
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/podcasts/:id" element={<ShowDetailPage />} />
      </Routes>,
      { path: '/podcasts/wissen' },
    );

    const description = await screen.findByRole('button', { name: /Geographie zum Hören/ });
    expect(description).toHaveAttribute('aria-expanded', 'false');
    description.focus();
    await user.keyboard('{Enter}');
    expect(description).toHaveAttribute('aria-expanded', 'true');
  });
});
