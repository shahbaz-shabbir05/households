import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isCivilDate, startOfMonth } from '@hms/shared';
import { ErrorBoundary } from '../app/ErrorBoundary.js';
import { Sheet } from '../components/ui/index.js';

/**
 * Regression: the `?month=` parameter was fed straight into date helpers that
 * throw on bad input, and with no boundary that unmounted the whole app.
 */
describe('calendar month parameter', () => {
  const resolve = (param: string | null, today: string) =>
    param && isCivilDate(param) ? param : startOfMonth(today);

  it('accepts a real date', () => {
    expect(resolve('2026-04-01', '2026-09-22')).toBe('2026-04-01');
  });

  it.each(['foo', '', '2026-13-01', '2026-02-30', 'NaN', '../../etc/passwd'])(
    'falls back to this month for %j',
    (param) => {
      expect(resolve(param, '2026-09-22')).toBe('2026-09-01');
    },
  );

  it('falls back when the parameter is absent', () => {
    expect(resolve(null, '2026-09-22')).toBe('2026-09-01');
  });
});

describe('ErrorBoundary', () => {
  function Boom(): never {
    throw new Error('render exploded');
  }

  it('shows a recoverable screen instead of unmounting the app', () => {
    // React logs the caught error; silence it so the run stays readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // Reassures the user about the thing they will actually worry about.
    expect(screen.getByText(/nothing was changed/i)).toBeInTheDocument();

    spy.mockRestore();
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('All fine')).toBeInTheDocument();
  });
});

/**
 * Regression: `Sheet` depended on `onClose`, which every call site passes as a
 * fresh arrow, so any parent re-render re-ran the focus effect and yanked the
 * caret out of whatever was being typed.
 */
describe('Sheet focus stability', () => {
  function Harness() {
    // A new onClose identity on every render, exactly like the real call sites.
    return (
      <Sheet open onClose={() => {}} title="Trip">
        <input aria-label="Total" />
      </Sheet>
    );
  }

  it('keeps the caret where the user put it across parent re-renders', async () => {
    const { rerender } = render(<Harness />);

    const input = screen.getByLabelText('Total');
    await userEvent.type(input, '4875');
    expect(input).toHaveFocus();

    // Simulate a background refetch re-rendering the parent.
    rerender(<Harness />);
    rerender(<Harness />);

    expect(input).toHaveFocus();
    expect(input).toHaveValue('4875');
  });
});
