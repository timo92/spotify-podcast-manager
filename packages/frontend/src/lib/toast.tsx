import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './toast.module.css';

export interface Toast {
  id: number;
  message: string;
  tone?: 'info' | 'error' | 'success';
  action?: { label: string; onClick: () => void };
}

/** How long a toast stays; one with an action longer, so there is time to reach it. */
const SHOW_MS = 4000;
const SHOW_WITH_ACTION_MS = 7000;

const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

/**
 * Shows toasts above the bottom bars. Errors are announced at once
 * (`role="alert"`), everything else politely. A toast stays while the pointer
 * is on it or the focus is in it, so its action can be reached.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
  }, []);

  const item = (toast: Toast) => <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />;
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={styles.toasts}>
        <div className={styles.region} role="alert">
          {toasts.filter((t) => t.tone === 'error').map(item)}
        </div>
        <div className={styles.region} role="status" aria-live="polite">
          {toasts.filter((t) => t.tone !== 'error').map(item)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { id, message, tone, action } = toast;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(action ? SHOW_WITH_ACTION_MS : SHOW_MS);

  useEffect(() => {
    if (hovered || focused) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [hovered, focused, id, onDismiss]);

  return (
    <div
      className={cx(styles.toast, tone === 'error' && styles.error)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <span>{message}</span>
      {action && (
        <button
          className={styles.action}
          onClick={() => {
            action.onClick();
            onDismiss(id);
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export const useToast = () => useContext(ToastContext);
