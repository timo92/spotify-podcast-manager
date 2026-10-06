import { screen, within } from '@testing-library/react';
import type { PlanDay, ScheduleRule, Weekday } from '@podcast/shared';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../src/lib/api';
import { WeekPage } from '../../src/pages/Week';
import { plannedItem, settings, show } from '../support/fixtures';
import { renderWithProviders } from '../support/render';
import { mockSchedule } from '../support/schedule';

const RULE: ScheduleRule = { id: 'r1', showId: 'wissen', weekdays: [1, 3, 5], part: 'EVENING' };

/** Mon 2026-10-05 … Sun 2026-10-11, with a slot on each weekday of `rules` and `openMs` open per day. */
function week(rules: ScheduleRule[], openMs = 0): PlanDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((d) => ({
    date: `2026-10-${String(4 + d).padStart(2, '0')}`,
    weekday: d as Weekday,
    isToday: d === 1,
    items: rules
      .filter((r) => r.weekdays.includes(d as Weekday))
      .map((r) => plannedItem({ ruleId: r.id, part: r.part })),
    openMs: rules.some((r) => r.weekdays.includes(d as Weekday)) ? openMs : 0,
  }));
}

function renderWeek(rules: ScheduleRule[], openMs = 0) {
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  vi.spyOn(api, 'shows').mockResolvedValue([show()]);
  vi.spyOn(api, 'week').mockResolvedValue({ days: week(rules, openMs) });
  vi.spyOn(api, 'today').mockRejectedValue(new Error('not needed'));
  const { saveSchedule } = mockSchedule(rules);
  return { ...renderWithProviders(<WeekPage />), saveSchedule };
}

/** The slot of `weekdayName` ("Montag", …) in the rendered week. */
function slotOn(weekdayName: string) {
  const day = screen.getByRole('heading', { name: new RegExp(weekdayName) }).closest('section')!;
  return within(day);
}

describe('WeekPage', () => {
  it('sums the open time of the week in the header', async () => {
    renderWeek([RULE], 20 * 60_000);
    expect(
      await screen.findByText('3 feste Termine pro Woche · 1 h offen in den nächsten 7 Tagen'),
    ).toBeInTheDocument();
  });

  it('claims no open time when nothing is open', async () => {
    renderWeek([RULE]);
    expect(await screen.findByText('3 feste Termine pro Woche')).toBeInTheDocument();
    expect(screen.queryByText(/offen/)).not.toBeInTheDocument();
  });

  it('adds a podcast as one rule', async () => {
    const { user, saveSchedule } = renderWeek([]);
    await user.click(await screen.findByRole('button', { name: /Ersten Termin anlegen/ }));
    const sheet = screen.getByRole('dialog', { name: 'Termin hinzufügen' });
    await user.click(await within(sheet).findByRole('button', { name: /Wissensreise/ }));
    await user.click(within(sheet).getByRole('radio', { name: 'Abends' }));
    expect(within(sheet).getByText('Gilt für Mo–Fr · Abends')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Wissensreise einplanen' }));
    expect(saveSchedule).toHaveBeenCalledWith({
      rules: [{ id: '', showId: 'wissen', weekdays: [1, 2, 3, 4, 5], part: 'EVENING' }],
      expectedUpdatedAt: null,
    });
  });

  it('edits a slot as its whole rule', async () => {
    const { user, saveSchedule } = renderWeek([RULE]);
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.click(slotOn('Mittwoch').getByRole('button', { name: 'Termin bearbeiten' }));
    const sheet = screen.getByRole('dialog', { name: 'Termin bearbeiten' });
    expect(within(sheet).getByText('Gilt für Mo, Mi, Fr · Abends')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Mi' }));
    await user.click(within(sheet).getByRole('button', { name: 'Speichern' }));
    expect(saveSchedule).toHaveBeenCalledWith({ rules: [{ ...RULE, weekdays: [1, 5] }], expectedUpdatedAt: null });
  });

  it('removes one day or the whole rule', async () => {
    const { user, saveSchedule } = renderWeek([RULE]);
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    await user.click(slotOn('Mittwoch').getByRole('button', { name: 'Aus dem Wochenplan entfernen' }));
    await user.click(screen.getByRole('button', { name: 'Nur am Mittwoch' }));
    expect(saveSchedule).toHaveBeenLastCalledWith({ rules: [{ ...RULE, weekdays: [1, 5] }], expectedUpdatedAt: null });

    await user.click(slotOn('Freitag').getByRole('button', { name: 'Aus dem Wochenplan entfernen' }));
    await user.click(screen.getByRole('button', { name: /Ganze Regel/ }));
    expect(saveSchedule).toHaveBeenLastCalledWith({ rules: [], expectedUpdatedAt: 'v1' });
  });

  it('removes a single-day rule without asking', async () => {
    const { user, saveSchedule } = renderWeek([{ ...RULE, weekdays: [3] }]);
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.click(slotOn('Mittwoch').getByRole('button', { name: 'Aus dem Wochenplan entfernen' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(saveSchedule).toHaveBeenCalledWith({ rules: [], expectedUpdatedAt: null });
  });
});
