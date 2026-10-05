import { screen, within } from '@testing-library/react';
import type { ScheduleRule } from '@podcast/shared';
import { describe, expect, it, vi } from 'vitest';
import { ShowSchedule } from '../../src/components/ShowSchedule';
import { api, ApiError } from '../../src/lib/api';
import { settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';
import { CONFLICT_MESSAGE, mockSchedule } from '../support/schedule';

const OWN: ScheduleRule = { id: 'r1', showId: 'wissen', weekdays: [1, 2, 3, 4, 5], part: 'MORNING' };
const OTHER: ScheduleRule = { id: 'r2', showId: 'other', weekdays: [6], part: 'EVENING' };

function renderCard(rules: ScheduleRule[]) {
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  vi.spyOn(api, 'shows').mockResolvedValue([show()]);
  const schedule = mockSchedule(rules);
  return { ...renderWithProviders(<ShowSchedule showId="wissen" showName="Wissensreise" />), ...schedule };
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
      expectedUpdatedAt: null,
    });
  });

  it('edits and removes a rule', async () => {
    const { user, saveSchedule } = renderCard([OWN, OTHER]);
    await user.click(await screen.findByRole('button', { name: 'Mo–Fr · Morgens bearbeiten' }));
    const sheet = screen.getByRole('dialog', { name: 'Termin bearbeiten' });
    await user.click(within(sheet).getByRole('button', { name: 'Fr' }));
    await user.click(within(sheet).getByRole('button', { name: 'Speichern' }));
    expect(saveSchedule).toHaveBeenLastCalledWith({
      rules: [{ ...OWN, weekdays: [1, 2, 3, 4] }, OTHER],
      expectedUpdatedAt: null,
    });

    // The card shows the saved plan.
    await user.click(await screen.findByRole('button', { name: 'Mo–Do · Morgens entfernen' }));
    expect(saveSchedule).toHaveBeenLastCalledWith({ rules: [OTHER], expectedUpdatedAt: 'v1' });
  });

  it('applies the edit to the newer plan when the plan changed elsewhere', async () => {
    const { user, saveSchedule, changeElsewhere } = renderCard([OWN, OTHER]);
    const remove = await screen.findByRole('button', { name: 'Mo–Fr · Morgens entfernen' });
    const added: ScheduleRule = { id: 'r3', showId: 'third', weekdays: [7], part: 'ANYTIME' };
    changeElsewhere([OTHER, added, OWN]);

    await user.click(remove);
    expect(saveSchedule).toHaveBeenCalledTimes(2);
    expect(saveSchedule).toHaveBeenNthCalledWith(1, { rules: [OTHER], expectedUpdatedAt: null });
    expect(saveSchedule).toHaveBeenNthCalledWith(2, { rules: [OTHER, added], expectedUpdatedAt: 'v1' });
    expect(await screen.findByText('Wissensreise: Mo–Fr · Morgens entfernt')).toBeInTheDocument();
  });

  it('reports a conflict that persists after re-applying the edit', async () => {
    const { user, saveSchedule } = renderCard([OWN, OTHER]);
    saveSchedule.mockRejectedValue(new ApiError(409, 'schedule_conflict', CONFLICT_MESSAGE));
    await user.click(await screen.findByRole('button', { name: 'Mo–Fr · Morgens entfernen' }));
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeInTheDocument();
    expect(saveSchedule).toHaveBeenCalledTimes(2);
  });
});
