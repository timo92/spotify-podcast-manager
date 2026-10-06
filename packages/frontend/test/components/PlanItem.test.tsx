import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlanItemRow } from '../../src/components/PlanItem';
import i18n from '../../src/i18n';
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
    // The cover links there too, hidden from assistive tech to avoid a duplicate link.
    const links = [...document.querySelectorAll('a')].filter((a) => a.getAttribute('href') === '/podcasts/wissen');
    expect(links).toHaveLength(2);
    await user.click(link);
    expect(screen.getByTestId('location')).toHaveTextContent('/podcasts/wissen');
  });

  it('shows when the episode was released', () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const releaseDate = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, '0'),
      String(yesterday.getDate()).padStart(2, '0'),
    ].join('-');
    renderSlot(plannedItem({ show: showLite(show({ mode: 'LATEST' })), episode: episode(1, { releaseDate }) }));
    expect(screen.getByText('Gestern · 20 min')).toBeInTheDocument();
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
      .getAllByText(/^Reise: Teil/)
      .map((el) => el.textContent);
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

  it('renders in English', async () => {
    await i18n.changeLanguage('en');
    renderSlot(
      plannedItem({ show: showLite(show({ mode: 'MANUAL' })), episode: null, state: 'none', part: 'MORNING' }),
    );
    expect(screen.getByText('Morning')).toBeInTheDocument();
    expect(screen.getByText('No episode chosen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose episode' })).toBeInTheDocument();
  });
});
