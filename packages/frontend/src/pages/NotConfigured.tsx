import { Trans, useTranslation } from 'react-i18next';
import type { Status } from '../lib/api';
import { cx } from '../lib/cx';
import styles from './auth.module.css';

/** Shown when the deployment has no Spotify client ID. There is nothing to enter here on purpose. */
export function NotConfiguredPage({ status }: { status: Status }) {
  const { t } = useTranslation('auth');
  return (
    <div className={styles.page}>
      <div className={cx(styles.card, styles.wide)}>
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>{t('setup.title')}</h1>
        <p className="muted">{t('setup.intro')}</p>
        <ol className={styles.steps}>
          <li>
            <Trans
              t={t}
              i18nKey="setup.step1"
              components={{
                dashboard: <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" />,
                strong: <strong />,
              }}
            />
            <div className={styles.copyField}>
              <code>{status.redirectUri}</code>
            </div>
          </li>
          <li>
            <Trans t={t} i18nKey="setup.step2" components={{ code: <code /> }} />
          </li>
          <li>{t('setup.step3')}</li>
        </ol>
      </div>
    </div>
  );
}
