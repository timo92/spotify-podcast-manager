import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, type Toast } from '../../src/lib/toast';

function Trigger({ toast }: { toast: Omit<Toast, 'id'> }) {
  const show = useToast();
  return (
    <button type="button" onClick={() => show(toast)}>
      Zeigen
    </button>
  );
}

const undo = { label: 'Rückgängig', onClick: () => {} };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Toasts', () => {
  it('announces errors as alerts and everything else politely', () => {
    render(
      <ToastProvider>
        <Trigger toast={{ message: 'Fehlgeschlagen', tone: 'error' }} />
        <Trigger toast={{ message: 'Gespeichert', tone: 'success' }} />
      </ToastProvider>,
    );
    for (const button of screen.getAllByRole('button', { name: 'Zeigen' })) fireEvent.click(button);
    expect(within(screen.getByRole('alert')).getByText('Fehlgeschlagen')).toBeInTheDocument();
    expect(within(screen.getByRole('status')).getByText('Gespeichert')).toBeInTheDocument();
  });

  it('stays while hovered or focused, then disappears after the rest of its time', () => {
    render(
      <ToastProvider>
        <Trigger toast={{ message: 'Als gehört markiert', action: undo }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zeigen' }));
    const toast = screen.getByText('Als gehört markiert').parentElement!;

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('Als gehört markiert')).toBeInTheDocument();

    fireEvent.mouseLeave(toast);
    fireEvent.focus(screen.getByRole('button', { name: 'Rückgängig' }));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('Als gehört markiert')).toBeInTheDocument();

    fireEvent.blur(screen.getByRole('button', { name: 'Rückgängig' }));
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText('Als gehört markiert')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByText('Als gehört markiert')).not.toBeInTheDocument();
  });
});
