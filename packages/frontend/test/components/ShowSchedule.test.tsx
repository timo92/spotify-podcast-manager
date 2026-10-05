import { screen, within } from '@testing-library/react';
import type { Schedule, ScheduleRule } from '@podcast/shared';
import { describe, expect, it, vi } from 'vitest';
import { ShowSchedule } from '../../src/components/ShowSchedule';
import { api } from '../../src/lib/api';
import { settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

const OWN: ScheduleRule = { id: 'r1', showId: 'wissen', weekdays: [1, 2, 3, 4, 5], part: 'MORNING' };
const OTHER: ScheduleRule = { id: 'r2', showId: 'other', weekdays: [6], part: 'EVENING' };

function renderCard(rules: ScheduleRule[]) {
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  vi.spyOn(api, 'shows').mockResolvedValue([show()]);
  vi.spyOn(api, 'schedule').mockResolvedValue({ rules });
  const saveSchedule = vi.spyOn(api, 'saveSchedule').mockImplementation(async (s: Schedule) => s);
  return { ...renderWithProviders(<ShowSchedule showId="wissen" showName="Wissensreise" />), saveSchedule };
}

describe('ShowSchedule', () => {
  it("lists only this podcast's rules", async () => {
    renderCard([OWN, OTHER]);
    expect(await screen.findByText('Mo–Fr · Morgens')).toBeInTheDocument();
    expect(screen.queryByText('Sa · Abends')).not.toBeInTheDocument();
  });

  it('says when the podcast is not planned', async () => {
    renderCard([OTHER]);
    expect(await screen.findByText('Nicht im Wochenplan.')).toBeInTheDocument();
  });

  it('adds a rule for this podcast and keeps the others', async () => {
    const { user, saveSchedule } = renderCard([OTHER]);
    await user.click(await screen.findByRole('button', { name: /Termin/ }));
    const sheet = screen.getByRole('dialog', { name: 'Termin hinzufügen' });
    expect(await within(sheet).findByText('Wissensreise')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Ändern' })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Wochenende' }));
    await user.click(within(sheet).getByRole('button', { name: 'Wissensreise einplanen' }));
    expect(saveSchedule).toHaveBeenCalledWith({
      rules: [OTHER, { id: '', showId: 'wissen', weekdays: [6, 7], part: 'ANYTIME' }],
    });
  });

  it('edits and removes a rule', async () => {
    const { user, saveSchedule } = renderCard([OWN, OTHER]);
    await user.click(await screen.findByRole('button', { name: 'Mo–Fr · Morgens bearbeiten' }));
    const sheet = screen.getByRole('dialog', { name: 'Termin bearbeiten' });
    await user.click(within(sheet).getByRole('button', { name: 'Fr' }));
    await user.click(within(sheet).getByRole('button', { name: 'Speichern' }));
    expect(saveSchedule).toHaveBeenLastCalledWith({ rules: [{ ...OWN, weekdays: [1, 2, 3, 4] }, OTHER] });

    // The card shows the saved plan.
    await user.click(await screen.findByRole('button', { name: 'Mo–Do · Morgens entfernen' }));
    expect(saveSchedule).toHaveBeenLastCalledWith({ rules: [OTHER] });
  });
});
