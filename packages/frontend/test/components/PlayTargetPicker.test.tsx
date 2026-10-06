import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlayTargetPicker } from '../../src/components/PlayerBar';
import { api } from '../../src/lib/api';
import { settings } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

describe('PlayTargetPicker', () => {
  it('opens as a menu the keyboard can move through and Escape closes', async () => {
    vi.spyOn(api, 'settings').mockResolvedValue(settings);
    vi.spyOn(api, 'devices').mockResolvedValue([{ id: 'iphone', name: 'iPhone', type: 'Smartphone', isActive: false }]);
    const { user } = renderWithProviders(<PlayTargetPicker />);
    const trigger = screen.getByRole('button', { name: /Wiedergabe auf/ });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Spotify-App öffnen' })).toHaveFocus();
    await screen.findByRole('menuitemradio', { name: /iPhone/ });
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: /iPhone/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Geräte aktualisieren' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Spotify-App öffnen' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });
});
