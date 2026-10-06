import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { Settings } from '@podcast/shared';
import { Icon } from '../components/Icon';
import { Chip, ErrorBox, Segmented, Spinner, Toggle } from '../components/ui';
import { setLanguage, storedLanguage, type Language } from '../i18n';
import { api } from '../lib/api';
import { cx } from '../lib/cx';
import { formatDateTime, syncError, syncText } from '../lib/format';
import { qk, useInvalidateLibrary, useSettings, useStatus } from '../lib/queries';
import { applyTheme, storedTheme, type Theme } from '../lib/theme';
import { useToast } from '../lib/toast';
import { useRun } from '../lib/actions';
import styles from './Settings.module.css';

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const settings = useSettings();
  const { data: status } = useStatus();
  const qc = useQueryClient();
  const invalidate = useInvalidateLibrary();
  const toast = useToast();
  const run = useRun();
  // Unsaved edits (e.g. a slider being dragged) over the stored settings.
  const [edited, setDraft] = useState<Settings | null>(null);
  const draft = edited ?? settings.data;
  const [newCat, setNewCat] = useState('');
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [language, setLanguageChoice] = useState<Language | 'auto'>(() => storedLanguage() ?? 'auto');
  const [confirmDelete, setConfirmDelete] = useState('');

  if (settings.error) return <ErrorBox error={settings.error} onRetry={() => void settings.refetch()} />;
  if (!draft) return <Spinner />;

  const current = draft;
  async function save(patch: Partial<Settings>) {
    const next = { ...current, ...patch };
    setDraft(next);
    try {
      const saved = await api.saveSettings(next);
      qc.setQueryData(qk.settings, saved);
      await invalidate();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      // Show what is stored: the saved value, or the old one after a failure.
      setDraft(null);
    }
  }

  /** For changes that affect everything the app shows (e.g. a full sync). */
  const runEverywhere = (fn: () => Promise<unknown>, message: string) =>
    run(fn, { message, refresh: () => qc.invalidateQueries() });

  /** Runs an action that ends the session (logout, deleting everything), then starts over. */
  function thenStartOver(action: () => Promise<unknown>) {
    action()
      .then(() => {
        window.location.href = '/';
      })
      .catch((e: Error) => toast({ message: e.message, tone: 'error' }));
  }

  const sync = status?.sync;

  return (
    <div className={cx('page', styles.page)}>
      <header className="page-head">
        <h1>{t('title')}</h1>
      </header>

      <section className="card stack">
        <h2 className="h3">{t('budget.title')}</h2>
        <label className={styles.field}>
          <span>
            {t('budget.perDay', {
              value: draft.audioBudgetMinutes
                ? t('budget.minutes', { count: draft.audioBudgetMinutes })
                : t('budget.unlimited'),
            })}
          </span>
          <input
            type="range"
            min={0}
            max={180}
            step={5}
            value={draft.audioBudgetMinutes}
            onChange={(e) => setDraft({ ...draft, audioBudgetMinutes: Number(e.target.value) })}
            onPointerUp={() => void save({})}
            onKeyUp={() => void save({})}
          />
        </label>
        <label className={styles.field}>
          <span>{t('budget.tolerance', { percent: draft.budgetTolerancePercent })}</span>
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={draft.budgetTolerancePercent}
            onChange={(e) => setDraft({ ...draft, budgetTolerancePercent: Number(e.target.value) })}
            onPointerUp={() => void save({})}
            onKeyUp={() => void save({})}
          />
          <small className="muted">{t('budget.toleranceHint')}</small>
        </label>
      </section>

      <section className="card stack">
        <h2 className="h3">{t('episodes.title')}</h2>
        <label className={styles.field}>
          <span>{t('episodes.newWindow', { days: draft.newWindowDays })}</span>
          <input
            type="range"
            min={1}
            max={30}
            value={draft.newWindowDays}
            onChange={(e) => setDraft({ ...draft, newWindowDays: Number(e.target.value) })}
            onPointerUp={() => void save({})}
            onKeyUp={() => void save({})}
          />
        </label>
        <Toggle
          label={t('episodes.spotifyState')}
          hint={t('episodes.spotifyStateHint')}
          checked={draft.useSpotifyPlayedState}
          onChange={(v) => void save({ useSpotifyPlayedState: v })}
        />
        <Toggle
          label={t('episodes.autoComplete')}
          hint={t('episodes.autoCompleteHint')}
          checked={draft.autoCompleteInPlayer}
          onChange={(v) => void save({ autoCompleteInPlayer: v })}
        />
      </section>

      <section className="card stack">
        <h2 className="h3">{t('categories.title')}</h2>
        <div className="chips">
          {draft.categories.map((c) => (
            <Chip key={c} onClick={() => void save({ categories: draft.categories.filter((x) => x !== c) })}>
              {c} <Icon name="close" size={14} />
            </Chip>
          ))}
          <form
            className="chip-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newCat.trim()) return;
              void save({ categories: [...draft.categories, newCat.trim()] });
              setNewCat('');
            }}
          >
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              placeholder={t('ui.categoryPlaceholder', { ns: 'common' })}
              aria-label={t('ui.newCategory', { ns: 'common' })}
            />
          </form>
        </div>
      </section>

      <section className="card stack">
        <h2 className="h3">{t('appearance.title')}</h2>
        <Segmented
          label={t('appearance.theme')}
          value={theme}
          onChange={(next) => {
            setTheme(next);
            applyTheme(next);
          }}
          options={[
            { value: 'system', label: t('appearance.system') },
            { value: 'light', label: t('appearance.light') },
            { value: 'dark', label: t('appearance.dark') },
          ]}
        />
        <Segmented
          label={t('appearance.language')}
          value={language}
          onChange={(lang) => {
            setLanguageChoice(lang);
            setLanguage(lang === 'auto' ? undefined : lang);
          }}
          options={[
            { value: 'auto', label: t('appearance.languageAuto') },
            { value: 'de', label: 'Deutsch' },
            { value: 'en', label: 'English' },
          ]}
        />
        <small className="muted">{t('appearance.languageHint')}</small>
      </section>

      <section className="card stack">
        <h2 className="h3">{t('sync.title')}</h2>
        <p className="muted small">
          {t('sync.schedule')}
          {sync?.lastSuccessAt && ` ${t('sync.lastSuccess', { date: formatDateTime(sync.lastSuccessAt) })}`}
          {sync?.status !== 'error' && syncText(sync) && ` ${syncText(sync)}`}
        </p>
        {sync?.status === 'error' && <ErrorBox error={syncError(sync)} />}
        <div className="row gap wrap">
          <button
            className="btn"
            disabled={sync?.status === 'running'}
            onClick={() => void runEverywhere(() => api.sync(false), t('sync.started'))}
          >
            <Icon name="refresh" size={18} /> {t('sync.now')}
          </button>
          <button
            className="btn"
            disabled={sync?.status === 'running'}
            onClick={() => void runEverywhere(() => api.sync(true), t('sync.fullStarted'))}
          >
            {t('sync.full')}
          </button>
        </div>
      </section>

      <section className="card stack">
        <h2 className="h3">{t('spotify.title')}</h2>
        <p className="small">
          <Trans
            t={t}
            i18nKey="spotify.connectedAs"
            values={{ name: status?.user?.displayName ?? status?.user?.id ?? '–' }}
            components={{ strong: <strong /> }}
          />
        </p>
        {status?.missingScopes && status.missingScopes.length > 0 && (
          <div className="banner banner-warn">
            {t('spotify.missingScopes', { scopes: status.missingScopes.join(', ') })}
          </div>
        )}
        <div className="row gap wrap">
          <a className="btn" href="/api/auth/login">
            {t('spotify.reconnect')}
          </a>
          <button className="btn" onClick={() => thenStartOver(api.logout)}>
            {t('spotify.logout')}
          </button>
        </div>
        <p className="muted small">{t('spotify.redirectUri', { uri: status?.redirectUri })}</p>
      </section>

      <section className="card stack">
        <h2 className="h3">{t('data.title')}</h2>
        <div className="row gap wrap">
          <a className="btn" href="/api/export" download>
            {t('data.export')}
          </a>
        </div>
        <details>
          <summary className="text-error">{t('data.deleteAll')}</summary>
          <p className="small">
            <Trans
              t={t}
              i18nKey="data.deleteText"
              values={{ word: t('data.confirmWord') }}
              components={{ strong: <strong /> }}
            />
          </p>
          <div className="row gap">
            <input
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              aria-label={t('data.confirmation')}
            />
            <button
              className="btn btn-danger"
              disabled={confirmDelete !== t('data.confirmWord')}
              onClick={() => thenStartOver(api.deleteAll)}
            >
              {t('data.deleteForever')}
            </button>
          </div>
        </details>
      </section>
    </div>
  );
}
