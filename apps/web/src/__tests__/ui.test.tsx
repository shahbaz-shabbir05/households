import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge, EmptyState, ErrorState, Field, Input, ListSkeleton, Sheet } from '../components/ui/index.js';

describe('Field', () => {
  it('associates a real label with its control', async () => {
    render(
      <Field label="Household name" required>
        {({ id, invalid }) => <Input id={id} invalid={invalid} />}
      </Field>,
    );
    // Found by its label, which is what a screen reader and a user both rely on.
    expect(screen.getByLabelText(/Household name/)).toBeInTheDocument();
  });

  it('announces the error and links it to the input', () => {
    render(
      <Field label="Email" error="Enter a valid email address">
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} invalid={invalid} />
        )}
      </Field>,
    );

    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid email address');
  });

  it('marks a required field for assistive technology, not just visually', () => {
    render(<Field label="Name" required>{({ id }) => <Input id={id} />}</Field>);
    expect(screen.getByText('(required)')).toBeInTheDocument();
  });
});

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    render(<Sheet open={false} onClose={() => {}} title="Add"><p>Body</p></Sheet>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a labelled modal dialog when open', () => {
    render(<Sheet open onClose={() => {}} title="Add something"><p>Body</p></Sheet>);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Add something');
  });

  it('focuses the first field rather than the first button', () => {
    render(
      <Sheet open onClose={() => {}} title="Add">
        <button type="button">A toolbar button</button>
        <input aria-label="Title" />
      </Sheet>,
    );
    // Focusing a toolbar button would cost a tab press on every open.
    expect(screen.getByLabelText('Title')).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="Add"><input aria-label="Title" /></Sheet>);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('mandatory states', () => {
  it('empty states are a call to action, not a statement of absence', () => {
    render(
      <EmptyState
        title="No bills yet"
        description="Add your first bill — we’ll remind you before it’s due."
        action={<button type="button">Add a bill</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add a bill' })).toBeInTheDocument();
  });

  it('error states offer a way out', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="The network dropped." onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('loading states are announced, not just drawn', () => {
    render(<ListSkeleton rows={2} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('carries a word, so colour is never the only signal', () => {
    render(<Badge tone="danger">Overdue by 3 days</Badge>);
    expect(screen.getByText('Overdue by 3 days')).toBeInTheDocument();
  });
});
