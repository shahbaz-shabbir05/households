import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../components/ui/toast.js';
import type { DoseView } from '../features/health/api.js';

/**
 * The household a dose belongs to. `useHousehold` normally comes from the
 * session; the dose row only needs the id, locale and timezone.
 */
vi.mock('../app/session.js', () => ({
  useHousehold: () => ({
    id: 'h1',
    name: 'Test',
    role: 'admin',
    timezone: 'Asia/Karachi',
    locale: 'en-PK',
    currency: 'PKR',
  }),
}));

const post = vi.fn(async (_path: string, _body: unknown) => ({}) as unknown);
vi.mock('../lib/api.js', () => ({
  api: {
    get: vi.fn(),
    getList: vi.fn(),
    post: (path: string, body: unknown) => post(path, body),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  qs: () => '',
  ApiError: class extends Error {},
}));

const { DoseRow } = await import('../features/health/HealthScreen.js');

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const dose = (over: Partial<DoseView> = {}): DoseView => ({
  id: 'd1',
  medicineId: 'm1',
  medicineName: 'Amoxicillin',
  doseText: 'half a 500mg tablet, dissolved in water',
  memberId: 'mem1',
  memberName: 'Hira',
  scheduledOn: '2026-10-29',
  scheduledAtTime: '09:00',
  status: 'due',
  recordedAt: null,
  ...over,
});

beforeEach(() => {
  post.mockClear();
});

describe('a dose on screen', () => {
  it('shows the dose text exactly as it was entered', () => {
    render(wrap(<DoseRow dose={dose()} />));

    // Not "0.5 × 500mg", not "half a tablet". What the prescription says.
    expect(screen.getByText('half a 500mg tablet, dissolved in water')).toBeInTheDocument();
  });

  it('offers exactly two actions: taken and skip', () => {
    render(wrap(<DoseRow dose={dose()} />));

    expect(screen.getByRole('button', { name: 'Taken' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    // Nothing that changes the prescription itself.
    expect(screen.queryByRole('button', { name: /adjust|change dose|double/i })).toBeNull();
  });

  it('records a taken dose without sending an amount', async () => {
    render(wrap(<DoseRow dose={dose()} />));
    await userEvent.click(screen.getByRole('button', { name: 'Taken' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post).toHaveBeenCalledWith('/households/h1/doses/d1/record', {
      status: 'taken',
      decrementStock: true,
    });
  });

  it('records a skip', async () => {
    render(wrap(<DoseRow dose={dose()} />));
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post.mock.calls[0]?.[1]).toMatchObject({ status: 'skipped' });
  });

  it('says a missed dose was missed rather than hiding it', () => {
    render(wrap(<DoseRow dose={dose({ status: 'missed' })} />));

    expect(screen.getByText('Missed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Taken' })).toBeInTheDocument();
  });

  it('offers nothing further once a dose is recorded', () => {
    render(wrap(<DoseRow dose={dose({ status: 'taken', recordedAt: '2026-10-29T04:05:00Z' })} />));

    expect(screen.queryByRole('button', { name: 'Taken' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });
});
