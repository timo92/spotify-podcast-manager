import { screen, within } from '@testing-library/react';
import { byPosition, type EpisodeNote } from '@podcast/shared';
import { describe, expect, it, vi } from 'vitest';
import { EpisodeNotes } from '../../src/components/Notes';
import { api } from '../../src/lib/api';
import { episodeItem } from '../../src/lib/player';
import { settings } from '../support/fixtures';
import { renderWithProviders } from '../support/render';

const ITEM = episodeItem({ showId: 'wissen', showName: 'Wissensreise', episodeId: 'ep-1', episodeName: 'Island' });

function note(id: string, positionMs: number | null, text: string): EpisodeNote {
  return {
    id,
    showId: 'wissen',
    episodeId: 'ep-1',
    positionMs,
    text,
    createdAt: `2026-10-0${id}T10:00:00Z`,
    updatedAt: 'u',
  };
}

/** Mocks the note endpoints with a list that each call changes, as the server does. */
function renderNotes(initial: EpisodeNote[]) {
  let stored = [...initial];
  let next = initial.length + 1;
  vi.spyOn(api, 'settings').mockResolvedValue(settings);
  vi.spyOn(api, 'show').mockRejectedValue(new Error('not needed'));
  vi.spyOn(api, 'notes').mockImplementation(async () => stored);
  vi.spyOn(api, 'episodeNotes').mockImplementation(async () => [...stored].sort(byPosition));
  const createNote = vi.spyOn(api, 'createNote').mockImplementation(async (_s, _e, input) => {
    const created = note(String(next++), input.positionMs ?? null, input.text);
    stored.push(created);
    return created;
  });
  const updateNote = vi.spyOn(api, 'updateNote').mockImplementation(async (ref, patch) => {
    const updated = { ...stored.find((n) => n.id === ref.id)!, ...patch };
    stored = stored.map((n) => (n.id === ref.id ? updated : n));
    return updated;
  });
  const deleteNote = vi.spyOn(api, 'deleteNote').mockImplementation(async (ref) => {
    stored = stored.filter((n) => n.id !== ref.id);
    return { ok: true };
  });
  const view = renderWithProviders(<EpisodeNotes item={ITEM} />);
  return { ...view, createNote, updateNote, deleteNote };
}

const texts = () => screen.queryAllByRole('article').map((a) => a.querySelector('p')?.textContent);

describe('EpisodeNotes', () => {
  it('lists the notes by position, notes on the whole episode first', async () => {
    renderNotes([note('1', 90_000, 'später'), note('2', null, 'zur ganzen Folge'), note('3', 5_000, 'früh')]);
    await screen.findByText('später');
    expect(texts()).toEqual(['zur ganzen Folge', 'früh', 'später']);
    expect(within(screen.getAllByRole('article')[2]!).getByRole('button', { name: '1:30' })).toBeInTheDocument();
  });

  it('adds a note and leaves its position to the server when the episode does not play in the browser', async () => {
    const { user, createNote } = renderNotes([note('1', 90_000, 'später')]);
    await screen.findByText('später');
    expect(screen.getByText('Läuft die Folge gerade in Spotify, wird die Stelle übernommen.')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Neue Notiz' }), 'Neuer Gedanke');
    await user.click(screen.getByRole('button', { name: 'Notiz hinzufügen' }));
    expect(createNote).toHaveBeenCalledWith('wissen', 'ep-1', { text: 'Neuer Gedanke' });
    expect(await screen.findByText('Neuer Gedanke')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Neue Notiz' })).toHaveValue('');
  });

  it('saves with Ctrl+Enter and saves a draft left when it closes', async () => {
    const { user, createNote, unmount } = renderNotes([]);
    const field = await screen.findByRole('textbox', { name: 'Neue Notiz' });
    await user.type(field, 'Per Tastatur{Control>}{Enter}{/Control}');
    expect(createNote).toHaveBeenLastCalledWith('wissen', 'ep-1', { text: 'Per Tastatur' });

    await user.type(field, 'Nicht abgeschickt');
    unmount();
    expect(createNote).toHaveBeenLastCalledWith('wissen', 'ep-1', { text: 'Nicht abgeschickt' });
  });

  it('edits the text and position of a single note', async () => {
    const { user, updateNote } = renderNotes([note('1', 90_000, 'später'), note('2', 5_000, 'früh')]);
    await screen.findByText('später');
    await user.click(within(screen.getAllByRole('article')[1]!).getByRole('button', { name: 'Notiz bearbeiten' }));

    const text = screen.getByRole('textbox', { name: 'Text der Notiz' });
    await user.clear(text);
    await user.type(text, 'korrigiert');
    const position = screen.getByRole('textbox', { name: /Stelle in der Folge/ });
    await user.clear(position);
    await user.type(position, '1:2');
    expect(screen.getByText('Bitte als mm:ss oder h:mm:ss angeben.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    await user.type(position, '0');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), {
      text: 'korrigiert',
      positionMs: 80_000,
    });
    expect(await screen.findByText('korrigiert')).toBeInTheDocument();
    expect(texts()).toEqual(['früh', 'korrigiert']);
  });

  it('turns a note into one on the whole episode when its position is cleared', async () => {
    const { user, updateNote } = renderNotes([note('1', 90_000, 'später')]);
    await user.click(await screen.findByRole('button', { name: 'Notiz bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: /Stelle in der Folge/ }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), { text: 'später', positionMs: null });
  });

  it('deletes a single note and can undo it', async () => {
    const { user, deleteNote, createNote } = renderNotes([note('1', 90_000, 'später'), note('2', 5_000, 'früh')]);
    await screen.findByText('später');
    await user.click(within(screen.getAllByRole('article')[0]!).getByRole('button', { name: 'Notiz löschen' }));
    expect(deleteNote).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
    expect(await screen.findByText('Notiz gelöscht')).toBeInTheDocument();
    expect(texts()).toEqual(['später']);

    await user.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(createNote).toHaveBeenCalledWith('wissen', 'ep-1', { text: 'früh', positionMs: 5_000 });
    expect(await screen.findByText('früh')).toBeInTheDocument();
  });
});
