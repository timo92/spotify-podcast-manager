import { screen } from '@testing-library/react';
import type { AppStatus, TodayResponse } from '@podcast/shared';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../src/lib/api';
import { TodayPage } from '../../src/pages/Today';
import { episode, showLite } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

const STATUS: AppStatus = { configured: true, authenticated: true, claimed: true, redirectUri: '' };

function today(overrides: Partial<TodayResponse> = {}): TodayResponse {
  return {
    plan: [],
    budgetMinutes: 30,
    recommendedMinutes: 30,
    budgetFit: 'perfect',
    recommended: [{ show: showLite(), episode: episode(1), label: 'NAECHSTE' }],
    more: [],
    noNewEpisode: [],
    recent: [],
    needsReviewCount: 0,
    newCount: 0,
    ...overrides,
  };
}

function renderToday(data: TodayResponse) {
  vi.spyOn(api, 'status').mockResolvedValue(STATUS);
  vi.spyOn(api, 'today').mockResolvedValue(data);
  return renderWithProviders(<TodayPage />);
}

describe('TodayPage', () => {
  it('says how the suggestions fit the budget', async () => {
    renderToday(today({ recommendedMinutes: 40, budgetFit: 'slightlyOver' }));
    expect(await screen.findByText('40 / 30 min · knapp drüber')).toBeInTheDocument();
  });

  it('calls a selection beyond the tolerance over budget', async () => {
    renderToday(today({ recommendedMinutes: 60, budgetFit: 'over' }));
    expect(await screen.findByText('60 / 30 min · über Budget')).toBeInTheDocument();
  });
});
