import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from '../../src/components/Sheet';
import { Menu } from '../../src/components/ui';

/** A button that opens a sheet, which can open a second one on top. */
function Opener({ onCloseOuter = () => {} }: { onCloseOuter?: () => void }) {
  const [open, setOpen] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen(1)}>
        Öffnen
      </button>
      {open >= 1 && (
        <Sheet
          label="Folge"
          onClose={() => {
            onCloseOuter();
            setOpen(0);
          }}
        >
          <button type="button" onClick={() => setOpen(2)}>
            Notiz
          </button>
          <button type="button">Abspielen</button>
          <Menu items={[{ label: 'Teilen', onClick: () => {} }]} />
        </Sheet>
      )}
      {open === 2 && (
        <Sheet label="Notiz bearbeiten" onClose={() => setOpen(1)}>
          <textarea aria-label="Text" />
        </Sheet>
      )}
    </>
  );
}

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

  it('takes the focus, keeps Tab inside and gives the focus back when it closes', async () => {
    const user = userEvent.setup();
    render(<Opener />);
    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    expect(screen.getByRole('dialog', { name: 'Folge' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Notiz' })).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Weitere Aktionen' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Notiz' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Weitere Aktionen' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Öffnen' })).toHaveFocus();
  });

  it('closes only the topmost of stacked sheets on Escape', async () => {
    const user = userEvent.setup();
    const onCloseOuter = vi.fn();
    render(<Opener onCloseOuter={onCloseOuter} />);
    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    await user.click(screen.getByRole('button', { name: 'Notiz' }));
    expect(screen.getByRole('dialog', { name: 'Notiz bearbeiten' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Notiz bearbeiten' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Folge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notiz' })).toHaveFocus();
    expect(onCloseOuter).not.toHaveBeenCalled();
  });

  it('lets Escape close a menu inside it without closing the sheet', async () => {
    const user = userEvent.setup();
    render(<Opener />);
    await user.click(screen.getByRole('button', { name: 'Öffnen' }));
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    expect(screen.getByRole('menuitem', { name: 'Teilen' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Folge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weitere Aktionen' })).toHaveFocus();
  });
});
