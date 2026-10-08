import { fireEvent, screen, waitFor } from '@testing-library/react';
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

  it('limits how far back the podcast is synced, and back to all episodes', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue(settings);
    let stored = show();
    vi.spyOn(api, 'show').mockImplementation(async () => ({ show: stored, episodes: [episode(1)] }));
    vi.spyOn(api, 'schedule').mockResolvedValue({ rules: [] });
    vi.spyOn(api, 'shows').mockImplementation(async () => [stored]);
    vi.spyOn(api, 'today').mockRejectedValue(new Error('not needed'));
    const updateShow = vi.spyOn(api, 'updateShow').mockImplementation(async (_id, patch) => {
      stored = { ...stored, ...patch };
      return stored;
    });
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/podcasts/:id" element={<ShowDetailPage />} />
      </Routes>,
      { path: '/podcasts/wissen' },
    );

    const select = await screen.findByRole('combobox', { name: 'Folgen synchronisieren' });
    expect(select).toHaveDisplayValue('Alle Folgen');
    await user.selectOptions(select, 'Letzte 30 Tage');
    expect(updateShow).toHaveBeenLastCalledWith('wissen', { syncWindowDays: 30 });
    await waitFor(() => expect(select).toHaveDisplayValue('Letzte 30 Tage'));
    await user.selectOptions(select, 'Alle Folgen');
    expect(updateShow).toHaveBeenLastCalledWith('wissen', { syncWindowDays: null });
  });

  it('keeps both categories when they are chosen in quick succession, and undoes a failed change', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue({ ...settings, categories: ['Reise', 'Wissen'] });
    // the server: a stored show that each save changes after a short delay
    let stored = show();
    vi.spyOn(api, 'show').mockImplementation(async () => ({ show: stored, episodes: [episode(1)] }));
    vi.spyOn(api, 'schedule').mockResolvedValue({ rules: [] });
    vi.spyOn(api, 'shows').mockImplementation(async () => [stored]);
    vi.spyOn(api, 'today').mockRejectedValue(new Error('not needed'));
    const updateShow = vi.spyOn(api, 'updateShow').mockImplementation(async (_id, patch) => {
      await new Promise((r) => setTimeout(r, 100));
      stored = { ...stored, ...patch };
      return stored;
    });
    const { user } = renderWithProviders(
      <Routes>
        <Route path="/podcasts/:id" element={<ShowDetailPage />} />
      </Routes>,
      { path: '/podcasts/wissen' },
    );

    // The first choice shows at once; the second click comes while it is still being saved.
    const reise = await screen.findByRole('button', { name: 'Reise' });
    fireEvent.click(reise);
    await waitFor(() => expect(reise).toHaveAttribute('aria-pressed', 'true'), { timeout: 50 });
    fireEvent.click(screen.getByRole('button', { name: 'Wissen' }));
    expect(updateShow).toHaveBeenLastCalledWith('wissen', { categories: ['Reise', 'Wissen'] });
    await waitFor(() => expect(stored.categories).toEqual(['Reise', 'Wissen']));

    updateShow.mockRejectedValue(new Error('Nicht gespeichert'));
    await user.click(screen.getByRole('button', { name: 'Wissen' }));
    expect(await screen.findByText('Nicht gespeichert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wissen' })).toHaveAttribute('aria-pressed', 'true');
  });
});
