import { act, screen, waitFor } from '@testing-library/react';
import type { AppStatus } from '@podcast/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncButton } from '../../src/components/Layout';
import { api } from '../../src/lib/api';
import { formatDateTime } from '../../src/lib/format';
import { renderWithProviders } from '../support/render';

function status(lastSuccessAt: string): AppStatus {
  return {
    configured: true,
    authenticated: true,
    claimed: true,
    redirectUri: '',
    sync: { status: 'idle', lastSuccessAt },
  };
}

afterEach(() => vi.useRealTimers());

describe('SyncButton', () => {
  it('names the exact time of the last sync on hover', async () => {
    const at = new Date(Date.now() - 90 * 60_000).toISOString();
    vi.spyOn(api, 'status').mockResolvedValue(status(at));
    renderWithProviders(<SyncButton />);
    const button = await screen.findByRole('button', { name: 'Mit Spotify synchronisieren' });
    await waitFor(() => expect(button).toHaveAttribute('title', `Zuletzt synchronisiert am ${formatDateTime(at)}`));
  });

  it('keeps the time since the last sync current while the page stays open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const start = Date.now();
    const statusCall = vi
      .spyOn(api, 'status')
      .mockResolvedValueOnce(status(new Date(start - 5 * 60_000).toISOString()))
      .mockResolvedValue(status(new Date(start).toISOString()));
    renderWithProviders(<SyncButton />);
    expect(await screen.findByText('vor 5 min')).toBeInTheDocument();
    // a scheduled sync finished at `start`; a minute later the label shows it
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(await screen.findByText('vor 1 min')).toBeInTheDocument();
    expect(statusCall).toHaveBeenCalledTimes(2);
  });
});
