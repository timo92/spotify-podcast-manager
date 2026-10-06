import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../src/lib/api';
import { ShowsPage } from '../../src/pages/Shows';
import { settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

const SHOWS = [show({ id: 'a', name: 'Alpha', priority: 1 }), show({ id: 'b', name: 'Beta', priority: 2 })];

function renderShows() {
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  vi.spyOn(api, 'shows').mockResolvedValue(SHOWS);
  return renderWithProviders(<ShowsPage />);
}

const names = () => screen.getAllByText(/^(Alpha|Beta)$/).map((e) => e.textContent);

describe('ShowsPage', () => {
  it('moves a podcast in the priority order', async () => {
    const reorder = vi.spyOn(api, 'reorder').mockResolvedValue(undefined);
    const { user } = renderShows();
    await screen.findByText('Alpha');
    await user.click(screen.getByRole('button', { name: /Priorität/ }));
    await user.click(screen.getAllByRole('button', { name: 'Nach unten' })[0]!);
    expect(reorder).toHaveBeenCalledWith(['b', 'a']);
    expect(names()).toEqual(['Beta', 'Alpha']);
  });

  it('puts a podcast back when moving it fails', async () => {
    vi.spyOn(api, 'reorder').mockRejectedValue(new Error('Reihenfolge nicht gespeichert'));
    const { user } = renderShows();
    await screen.findByText('Alpha');
    await user.click(screen.getByRole('button', { name: /Priorität/ }));
    await user.click(screen.getAllByRole('button', { name: 'Nach unten' })[0]!);
    expect(await screen.findByText('Reihenfolge nicht gespeichert')).toBeInTheDocument();
    expect(names()).toEqual(['Alpha', 'Beta']);
  });

  it('puts a choice on a review card back when saving it fails', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue(settings);
    vi.spyOn(api, 'shows').mockResolvedValue([show({ needsReview: true, mode: 'SEQUENTIAL' })]);
    vi.spyOn(api, 'updateShow').mockRejectedValue(new Error('Nicht gespeichert'));
    const { user } = renderWithProviders(<ShowsPage />, { path: '/podcasts?pruefen=1' });
    await user.click(await screen.findByRole('radio', { name: /Aktualität/ }));
    expect(await screen.findByText('Nicht gespeichert')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Reihenfolge/ })).toHaveAttribute('aria-checked', 'true');
  });
});
