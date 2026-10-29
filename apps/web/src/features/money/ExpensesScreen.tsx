/**
 * What the household spent.
 *
 * Deliberately not a dashboard of charts. The month's total is a *hero figure*
 * with a comparison, because a single current value is a stat tile and never a
 * one-bar chart. The category breakdown is a magnitude comparison, so its bars
 * use one hue — the categories are direct-labelled, so colour carries no
 * information and a categorical palette would only add noise (docs/11).
 */

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Receipt, TrendingDown, TrendingUp, Plus } from 'lucide-react';
import { formatMoney, parseMoneyInput, percentOf, type ExpenseCategory } from '@hms/shared';
import { useHousehold } from '../../app/session.js';
import { PageHeader } from '../../app/AppShell.js';
import {
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
import { useMembers } from '../family/api.js';
import { useExpenseSummary, useExpenses, useCreateExpense } from './api.js';

const CATEGORIES: ExpenseCategory[] = [
  'groceries', 'utilities', 'rent', 'education', 'medical', 'transport',
  'clothing', 'household', 'entertainment', 'dining', 'travel', 'gifts',
  'personal', 'subscriptions', 'maintenance', 'other',
];

const label = (value: string) => value[0]!.toUpperCase() + value.slice(1);

export function ExpensesScreen() {
  const household = useHousehold();
  const [params] = useSearchParams();
  const month = params.get('month') ?? undefined;
  const [addOpen, setAddOpen] = useState(false);

  const summary = useExpenseSummary(household.id, month);
  const expenses = useExpenses(household.id, month ? { from: `${month}-01` } : {});

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Where the money went"
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        }
      />

      {summary.isPending ? (
        <ListSkeleton rows={2} />
      ) : summary.isError ? (
        <ErrorState
          message={summary.error instanceof Error ? summary.error.message : 'We could not load your spending.'}
          onRetry={() => void summary.refetch()}
        />
      ) : (
        <div className="space-y-5">
          <MonthTotal
            totalMinor={summary.data.totalMinor}
            previousMinor={summary.data.previousMonthMinor}
            changePercent={summary.data.changePercent}
            currency={summary.data.currency}
            locale={household.locale}
            count={summary.data.expenseCount}
          />

          {summary.data.byCategory.length > 0 && (
            <CategoryBreakdown
              rows={summary.data.byCategory}
              totalMinor={summary.data.totalMinor}
              currency={summary.data.currency}
              locale={household.locale}
            />
          )}

          <section>
            <h2 className="mb-2 px-1 text-sm font-semibold tracking-wide text-slate-600 uppercase">
              Recent
            </h2>
            {expenses.isPending ? (
              <ListSkeleton rows={4} />
            ) : expenses.data && expenses.data.data.length > 0 ? (
              <ul className="space-y-2">
                {expenses.data.data.map((expense) => (
                  <li key={expense.id}>
                    <Card className="flex items-center gap-3 p-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                        <Receipt className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {expense.merchant ?? expense.description ?? label(expense.category)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {friendlyDate(expense.spentOn, todayIn(household.timezone), household.locale)}
                          {' · '}{label(expense.category)}
                          {expense.paidByName && ` · ${expense.paidByName}`}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-slate-900 tabular-nums">
                        {formatMoney(expense.amountMinor, expense.currency, household.locale)}
                      </span>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<Receipt className="h-10 w-10" />}
                title="Nothing recorded yet"
                description="Add what you spend as you go, or finish a shopping trip — that records the spend for you."
                action={<Button onClick={() => setAddOpen(true)}>Add an expense</Button>}
              />
            )}
          </section>
        </div>
      )}

      <AddExpenseSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

/** A single current value: a hero figure with a delta, never a one-bar chart. */
function MonthTotal({
  totalMinor,
  previousMinor,
  changePercent,
  currency,
  locale,
  count,
}: {
  totalMinor: number;
  previousMinor: number;
  changePercent: number | null;
  currency: string;
  locale: string;
  count: number;
}) {
  const up = changePercent !== null && changePercent > 0;

  return (
    <Card className="p-5">
      <p className="text-sm text-slate-500">Spent this month</p>
      <p className="mt-1 text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {formatMoney(totalMinor, currency, locale)}
      </p>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-slate-600">
        {changePercent === null ? (
          // A jump from nothing is not a percentage increase — say so plainly.
          <span>{previousMinor === 0 ? 'Nothing recorded last month' : 'No comparison available'}</span>
        ) : (
          <>
            {/* The arrow and the words carry the direction; colour only reinforces. */}
            {up ? (
              <TrendingUp className="h-4 w-4 text-danger" aria-hidden="true" />
            ) : (
              <TrendingDown className="h-4 w-4 text-success" aria-hidden="true" />
            )}
            <span>
              <span className={cx('font-medium', up ? 'text-danger' : 'text-success')}>
                {Math.abs(changePercent).toFixed(0)}% {up ? 'more' : 'less'}
              </span>{' '}
              than last month ({formatMoney(previousMinor, currency, locale)})
            </span>
          </>
        )}
      </p>

      <p className="mt-1 text-xs text-slate-400">
        {count} expense{count === 1 ? '' : 's'} recorded
      </p>
    </Card>
  );
}

/**
 * Magnitude by category: one hue, more-is-longer, every row direct-labelled
 * with its value. Because the value is already on screen, there is nothing a
 * tooltip could add.
 */
function CategoryBreakdown({
  rows,
  totalMinor,
  currency,
  locale,
}: {
  rows: Array<{ category: ExpenseCategory; amountMinor: number; count: number }>;
  totalMinor: number;
  currency: string;
  locale: string;
}) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-sm font-semibold tracking-wide text-slate-600 uppercase">
        By category
      </h2>
      <Card className="divide-y divide-slate-100">
        {rows.map((row) => {
          const share = percentOf(row.amountMinor, totalMinor) ?? 0;
          return (
            <div key={row.category} className="p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium text-slate-800">
                  {label(row.category)}
                </span>
                <span className="shrink-0 text-sm text-slate-900 tabular-nums">
                  {formatMoney(row.amountMinor, currency, locale)}
                  <span className="ml-1.5 text-xs text-slate-400">{share.toFixed(0)}%</span>
                </span>
              </div>
              {/*
                Track is one step off the surface and square, so the fill is
                anchored to a real baseline; only the data end is rounded
                (4px on an 8px bar). A fully rounded track would round the
                baseline too and make short bars read as floating.
              */}
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-sm bg-slate-100">
                <div
                  className="h-full rounded-r-full bg-brand-600"
                  style={{ width: share === 0 ? '0%' : `${Math.max(share, 1.5)}%` }}
                  role="img"
                  aria-label={`${label(row.category)}: ${share.toFixed(0)} percent of this month’s spending`}
                />
              </div>
            </div>
          );
        })}
      </Card>
    </section>
  );
}

function AddExpenseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const household = useHousehold();
  const toast = useToast();
  const createExpense = useCreateExpense(household.id);
  const members = useMembers(household.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const amountMinor = parseMoneyInput(amount, household.currency);
    if (amountMinor === null) {
      // Never silently record a zero — that is a free purchase nobody made.
      setErrors({ amountMinor: 'Enter an amount' });
      return;
    }

    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await createExpense.mutateAsync({
        amountMinor,
        spentOn: String(form.spentOn),
        category: form.category as ExpenseCategory,
        paymentMethod: form.paymentMethod as never,
        paidByMemberId: String(form.paidByMemberId),
        merchant: form.merchant ? String(form.merchant) : undefined,
      } as never);
      toast.success('Expense recorded');
      setAmount('');
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      toast.error(error instanceof ApiError ? error.message : 'Could not record that');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add an expense">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label={`How much? (${household.currency})`} error={errors.amountMinor} required>
          {({ id, invalid }) => (
            <Input
              id={id}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="1250"
              invalid={invalid}
              autoFocus
              required
            />
          )}
        </Field>

        <Field label="What for?" error={errors.category}>
          {({ id }) => (
            <Select id={id} name="category" defaultValue="groceries">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{label(c)}</option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="When" error={errors.spentOn}>
          {({ id }) => (
            <Input id={id} name="spentOn" type="date" defaultValue={todayIn(household.timezone)} />
          )}
        </Field>

        <Field label="Who paid" error={errors.paidByMemberId}>
          {({ id }) => (
            <Select id={id} name="paidByMemberId" defaultValue={household.memberId}>
              {(members.data ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.isSelf ? `${member.displayName} (me)` : member.displayName}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="How did you pay?">
          {({ id }) => (
            <Select id={id} name="paymentMethod" defaultValue="cash">
              <option value="cash">Cash</option>
              <option value="easypaisa">Easypaisa</option>
              <option value="jazzcash">JazzCash</option>
              <option value="debit_card">Debit card</option>
              <option value="credit_card">Credit card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>

        <Field label="Where" hint="Optional">
          {({ id }) => <Input id={id} name="merchant" placeholder="e.g. Imtiaz" />}
        </Field>

        <Button type="submit" size="lg" loading={createExpense.isPending} className="w-full">
          Record expense
        </Button>
      </form>
    </Sheet>
  );
}
