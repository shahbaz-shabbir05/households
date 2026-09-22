/**
 * Bills — what the household owes, and when.
 *
 * The screen answers Bilal's question first (docs/02): what is due, what is
 * late, and how much of it is there. Paying is one tap from the row, because
 * the moment someone is looking at an overdue bill is the moment they will act
 * on it.
 */

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarClock, Check, Plus, Repeat, Trash2, Undo2 } from 'lucide-react';
import { createBillSchema, formatMoney, parseMoneyInput } from '@hms/shared';
import { useHousehold } from '../../app/session.js';
import { PageHeader } from '../../app/AppShell.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListSkeleton,
  Select,
  Sheet,
  cx,
} from '../../components/ui/index.js';
import { useToast } from '../../components/ui/toast.js';
import { ApiError } from '../../lib/api.js';
import { friendlyDate, todayIn } from '../../lib/format.js';
import {
  useBills,
  useCreateBill,
  useDeleteBill,
  usePayBill,
  useUnpayBill,
  type BillView,
} from './bills-api.js';

const VIEWS = [
  { key: 'due', label: 'Due', filters: { unpaid: true } },
  { key: 'subscriptions', label: 'Subscriptions', filters: { billType: 'subscription' } },
  { key: 'paid', label: 'Paid', filters: { status: 'paid' } },
  { key: 'all', label: 'All', filters: {} },
] as const;

export function BillsScreen() {
  const household = useHousehold();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'due';
  const [addOpen, setAddOpen] = useState(false);
  const [paying, setPaying] = useState<BillView | null>(null);

  const active = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  const query = useBills(household.id, { ...active.filters, sort: 'dueDate', order: 'asc' });
  const today = todayIn(household.timezone);

  return (
    <div>
      <PageHeader
        title="Bills"
        subtitle="What's owed, and when"
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        }
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Bill views">
        {VIEWS.map((option) => (
          <button
            key={option.key}
            role="tab"
            aria-selected={view === option.key}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('view', option.key);
              setParams(next, { replace: true });
            }}
            className={cx(
              'shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
              view === option.key
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* The one number this screen exists to show. */}
      {query.data?.totals && query.data.totals.outstandingAmountMinor > 0 && (
        <Card className="mb-4 p-4">
          <p className="text-sm text-slate-500">Still to pay</p>
          <p className="mt-0.5 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {formatMoney(
              query.data.totals.outstandingAmountMinor,
              query.data.totals.currency,
              household.locale,
            )}
          </p>
        </Card>
      )}

      {query.isPending ? (
        <ListSkeleton rows={4} />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'We could not load your bills.'}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-10 w-10" />}
          title={view === 'paid' ? 'Nothing paid yet' : 'No bills here'}
          description="Add a bill and we'll tell you before it's due — and paying it records the spend for you."
          action={<Button onClick={() => setAddOpen(true)}>Add a bill</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {query.data.data.map((bill) => (
            <li key={bill.id}>
              <BillRow bill={bill} today={today} onPay={() => setPaying(bill)} />
            </li>
          ))}
        </ul>
      )}

      <AddBillSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <PayBillSheet bill={paying} onClose={() => setPaying(null)} />
    </div>
  );
}

function BillRow({ bill, today, onPay }: { bill: BillView; today: string; onPay: () => void }) {
  const household = useHousehold();
  const toast = useToast();
  const unpay = useUnpayBill(household.id);
  const remove = useDeleteBill(household.id);
  const [confirming, setConfirming] = useState(false);

  const isPaid = bill.status === 'paid';

  return (
    <Card className={cx('p-3', bill.status === 'overdue' && 'ring-danger/30')}>
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            isPaid ? 'bg-success-bg text-success' : 'bg-slate-100 text-slate-500',
          )}
        >
          {isPaid ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className={cx('truncate text-sm font-medium', isPaid ? 'text-slate-500' : 'text-slate-900')}>
            {bill.name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>{isPaid ? `Paid ${friendlyDate(bill.paidOn!, today, household.locale)}` : `Due ${friendlyDate(bill.dueDate, today, household.locale)}`}</span>
            {bill.providerName && <span>· {bill.providerName}</span>}
            {bill.isRecurring && (
              <span className="inline-flex items-center gap-1">
                <Repeat className="h-3 w-3" aria-hidden="true" />
                Repeats
              </span>
            )}
          </div>
          {bill.status === 'overdue' && (
            <p className="mt-1.5">
              {/* Icon and words, not colour alone. */}
              <Badge tone="danger" icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}>
                {bill.daysOverdue === 1 ? 'Overdue by 1 day' : `Overdue by ${bill.daysOverdue} days`}
              </Badge>
            </p>
          )}
          {bill.status === 'due' && (
            <p className="mt-1.5"><Badge tone="warning">Due soon</Badge></p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-sm font-semibold text-slate-900 tabular-nums">
            {formatMoney(bill.paidAmountMinor ?? bill.amountMinor, bill.currency, household.locale)}
          </span>
          {isPaid ? (
            <Button
              size="sm"
              variant="ghost"
              loading={unpay.isPending}
              onClick={() => {
                unpay.mutate(bill.id, {
                  onSuccess: () => toast.success('Payment undone'),
                  onError: () => toast.error('Could not undo that'),
                });
              }}
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              Undo
            </Button>
          ) : (
            <Button size="sm" onClick={onPay}>Pay</Button>
          )}
        </div>
      </div>

      {!isPaid && (
        <div className="mt-2 flex justify-end">
          <Button
            variant="ghost"
            iconOnly
            aria-label={`Delete "${bill.name}"`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="h-4 w-4 text-slate-400" />
          </Button>
        </div>
      )}

      {confirming && (
        <div className="mt-2 rounded-lg bg-slate-50 p-3">
          <p className="text-sm text-slate-700">Delete “{bill.name}”?</p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                remove.mutate(bill.id, {
                  onSuccess: () => toast.success('Bill deleted'),
                  onSettled: () => setConfirming(false),
                });
              }}
            >
              Delete
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function PayBillSheet({ bill, onClose }: { bill: BillView | null; onClose: () => void }) {
  const household = useHousehold();
  const toast = useToast();
  const payBill = usePayBill(household.id);

  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!bill) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    if (!bill) return;

    // Blank means "the amount on the bill", which is the common case.
    const amountMinor = amount.trim() === '' ? undefined : parseMoneyInput(amount, bill.currency);
    if (amountMinor === null) {
      setErrors({ amountMinor: 'That is not an amount' });
      return;
    }

    try {
      const result = await payBill.mutateAsync({
        billId: bill.id,
        input: {
          ...(amountMinor !== undefined ? { amountMinor } : {}),
          paymentMethod: paymentMethod as never,
          recordExpense: true,
        } as never,
      });
      toast.success(
        result.expense
          ? `Paid, and ${formatMoney(result.expense.amountMinor, result.expense.currency, household.locale)} recorded`
          : 'Marked as paid',
      );
      setAmount('');
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      toast.error(error instanceof ApiError ? error.message : 'Could not record that payment');
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Pay ${bill.name}`}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900">
          This records the payment and adds{' '}
          {formatMoney(bill.amountMinor, bill.currency, household.locale)} to your expenses.
        </div>

        <Field
          label={`Amount (${bill.currency})`}
          error={errors.amountMinor}
          hint={`Leave empty to pay the full ${formatMoney(bill.amountMinor, bill.currency, household.locale)}`}
        >
          {({ id, invalid }) => (
            <Input
              id={id}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={String(bill.amountMinor / 100)}
              invalid={invalid}
            />
          )}
        </Field>

        <Field label="How did you pay?">
          {({ id }) => (
            <Select id={id} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="easypaisa">Easypaisa</option>
              <option value="jazzcash">JazzCash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="debit_card">Debit card</option>
              <option value="credit_card">Credit card</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>

        <Button type="submit" size="lg" loading={payBill.isPending} className="w-full">
          Mark as paid
        </Button>
      </form>
    </Sheet>
  );
}

function AddBillSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const household = useHousehold();
  const toast = useToast();
  const createBill = useCreateBill(household.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');
  const [repeats, setRepeats] = useState(true);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const amountMinor = parseMoneyInput(amount, household.currency);
    if (amountMinor === null) {
      setErrors({ amountMinor: 'Enter the amount' });
      return;
    }

    const form = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = createBillSchema.safeParse({
      ...form,
      amountMinor,
      // Most household bills repeat monthly; defaulting to that saves the
      // step people would otherwise forget, and it is one tap to turn off.
      ...(repeats ? { recurrence: { freq: 'monthly', interval: 1 } } : {}),
    });

    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }

    try {
      await createBill.mutateAsync(parsed.data);
      toast.success('Bill added');
      setAmount('');
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      toast.error(error instanceof ApiError ? error.message : 'Could not add that bill');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add a bill">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="What is it?" error={errors.name} required>
          {({ id, invalid }) => (
            <Input id={id} name="name" placeholder="e.g. Electricity" invalid={invalid} required />
          )}
        </Field>

        <Field label={`Amount (${household.currency})`} error={errors.amountMinor} required>
          {({ id, invalid }) => (
            <Input
              id={id}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="18400"
              invalid={invalid}
              required
            />
          )}
        </Field>

        <Field label="Due date" error={errors.dueDate} required>
          {({ id }) => (
            <Input id={id} name="dueDate" type="date" defaultValue={todayIn(household.timezone)} required />
          )}
        </Field>

        <Field label="Who do you pay?" error={errors.providerName} hint="Optional — we'll remember it">
          {({ id }) => <Input id={id} name="providerName" placeholder="e.g. K-Electric" />}
        </Field>

        <Field label="Account or reference number" error={errors.accountNumber} hint="Optional">
          {({ id }) => <Input id={id} name="accountNumber" />}
        </Field>

        <Field label="Kind">
          {({ id }) => (
            <Select id={id} name="billType" defaultValue="utility">
              <option value="utility">Utility</option>
              <option value="rent">Rent</option>
              <option value="subscription">Subscription</option>
              <option value="fee">Fee</option>
              <option value="insurance">Insurance</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={repeats}
            onChange={(event) => setRepeats(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          This comes every month
        </label>

        <Button type="submit" size="lg" loading={createBill.isPending} className="w-full">
          Add bill
        </Button>
      </form>
    </Sheet>
  );
}
