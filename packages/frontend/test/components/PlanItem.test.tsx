import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlanItemRow } from '../../src/components/PlanItem';
import { api } from '../../src/lib/api';
import { episode, plannedItem, settings, show, showLite } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

function renderSlot(item = plannedItem()) {
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  return renderWithProviders(
    <ul>
      <PlanItemRow item={item} isToday onOpen={() => {}} />
    </ul>,
  );
}

describe('PlanItemRow', () => {
  it('links the podcast name and cover to the podcast', async () => {
    const { user } = renderSlot();
    const link = screen.getByRole('link', { name: 'Wissensreise' });
    expect(link).toHaveAttribute('href', '/podcasts/wissen');
    expect(document.querySelector('a.plan-item-cover')).toHaveAttribute('href', '/podcasts/wissen');
    await user.click(link);
    expect(screen.getByTestId('location')).toHaveTextContent('/podcasts/wissen');
  });

  it('lets the user pick the episode of a manual podcast in place', async () => {
    const manual = show({ mode: 'MANUAL' });
    vi.spyOn(api, 'show').mockResolvedValue({
      show: manual,
      episodes: [episode(1, { status: 'COMPLETED' }), episode(2), episode(3, { status: 'IN_PROGRESS' })],
    });
    const updateShow = vi.spyOn(api, 'updateShow').mockResolvedValue({ ...manual, pinnedEpisodeId: 'ep-2' });
    const { user } = renderSlot(plannedItem({ show: showLite(manual), episode: null, state: 'none' }));

    expect(screen.getByText('Keine Folge gewählt')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Folge wählen' }));
    const picker = await screen.findByRole('dialog', { name: 'Folge wählen' });
    // open episodes only, newest first
    const titles = within(picker)
      .getAllByRole('button')
      .map((b) => b.querySelector('.pick-title')?.textContent)
      .filter(Boolean);
    expect(titles).toEqual(['Reise: Teil 3', 'Reise: Teil 2']);

    await user.click(within(picker).getByText('Reise: Teil 2'));
    expect(updateShow).toHaveBeenCalledWith('wissen', { pinnedEpisodeId: 'ep-2' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers no picker for other modes', () => {
    renderSlot(plannedItem({ episode: null, state: 'none' }));
    expect(screen.getByText('Alles gehört 🎉')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Folge wählen' })).not.toBeInTheDocument();
  });
});
