import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { PlayerProvider } from '../../src/lib/player';
import { ToastProvider } from '../../src/lib/toast';

/** Shows the current path, so tests can assert on navigation. */
function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

/**
 * Renders `ui` with the providers of the app (query client without retries,
 * toasts, player, router at `path`). API calls are mocked per test with
 * `vi.spyOn(api, …)`; anything else fails (see setup.ts).
 */
export function renderWithProviders(ui: ReactElement, { path = '/' }: { path?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const user = userEvent.setup();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <PlayerProvider>
            <Routes>
              <Route path="*" element={ui} />
            </Routes>
            <LocationProbe />
          </PlayerProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, user, queryClient };
}
