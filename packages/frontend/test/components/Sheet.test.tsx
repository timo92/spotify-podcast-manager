import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from '../../src/components/Sheet';

describe('Sheet', () => {
  it('is a labelled modal dialog that Escape and a backdrop click close', () => {
    const onClose = vi.fn();
    render(
      <Sheet label="Termin bearbeiten" onClose={onClose}>
        <button type="button">Speichern</button>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Termin bearbeiten' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
