import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './toast.module.css';

export interface Toast {
  id: number;
  message: string;
  tone?: 'info' | 'error' | 'success';
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), t.action ? 7000 : 4000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={styles.toasts} role="status" aria-live="polite">
        {toasts.map(({ id, message, tone, action }) => (
          <div key={id} className={cx(styles.toast, tone === 'error' && styles.error)}>
            <span>{message}</span>
            {action && (
              <button
                className={styles.action}
                onClick={() => {
                  action.onClick();
                  dismiss(id);
                }}
              >
                {action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
