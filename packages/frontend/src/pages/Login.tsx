import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { Status } from '../lib/api';
import styles from './auth.module.css';

export function LoginPage({ status }: { status: Status }) {
  const { t, i18n } = useTranslation('auth');
  const [params] = useSearchParams();
  const error = params.get('error');
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>{t('appName', { ns: 'common' })}</h1>
        <p className="muted">{t('tagline')}</p>
        {error && (
          <div className="banner banner-error" role="alert">
            {i18n.exists(`error.${error}`, { ns: 'auth' })
              ? t(`error.${error}` as 'error.access_denied')
              : t('loginFailed', { code: error })}
          </div>
        )}
        <a className="btn btn-primary btn-block" href="/api/auth/login">
          {t('login')}
        </a>
        <p className="muted small">{t('redirectUri', { uri: status.redirectUri })}</p>
      </div>
    </div>
  );
}
