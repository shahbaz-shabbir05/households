/**
 * Budgets.
 *
 * A budget is a single ratio against a limit, which is a **meter** and a
 * number — not a chart (docs/11). Each row is one track, one hue, direct
 * labels, and a state that is carried by an icon and words as well as colour.
 */

import { useState, type FormEvent } from 'react';
import { AlertTriangle, Check, PiggyBank, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { createBudgetSchema, formatMoney, parseMoneyInput, type ExpenseCategory } from '@hms/shared';
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
import { useBudgetStatus, useCreateBudget, useDeleteBudget, type BudgetStatusView } from './bills-api.js';

const CATEGORIES: ExpenseCategory[] = [
  'groceries', 'utilities', 'rent', 'education', 'medical', 'transport',
  'clothing', 'household', 'entertainment', 'dining', 'travel', 'gifts',
  'personal', 'subscriptions', 'maintenance', 'other',
];

const label = (value: string) => value[0]!.toUpperCase() + value.slice(1);

export function BudgetsScreen() {
  const household = useHousehold();
  const query = useBudgetStatus(household.id);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div>
      <PageHeader
        title="Budgets"
        subtitle="Monthly limits, and how close you are"
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        }
      />

      {query.isPending ? (
        <ListSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'We could not load your budgets.'}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={<PiggyBank className="h-10 w-10" />}
          title="No budgets set"
          description="Set a monthly limit for the things that creep — groceries, dining, subscriptions — and we'll warn you before you cross it, not after."
          action={<Button onClick={() => setAddOpen(true)}>Set a budget</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {query.data.map((budget) => (
            <li key={budget.id}>
              <BudgetRow budget={budget} />
            </li>
          ))}
        </ul>
      )}

      <AddBudgetSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

const STATE_BADGE = {
  under: { tone: 'success' as const, icon: <Check className="h-3 w-3" aria-hidden="true" />, text: 'On track' },
  approaching: {
    tone: 'warning' as const,
    icon: <TriangleAlert className="h-3 w-3" aria-hidden="true" />,
    text: 'Getting close',
  },
  over: {
    tone: 'danger' as const,
    icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
    text: 'Over budget',
  },
};

function BudgetRow({ budget }: { budget: BudgetStatusView }) {
  const household = useHousehold();
  const toast = useToast();
  const remove = useDeleteBudget(household.id);

  const used = budget.usedPercent ?? 0;
  const badge = STATE_BADGE[budget.state];
  const name = budget.category ? label(budget.category) : 'Everything';

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium text-slate-800">{name}</span>
        <span className="shrink-0 text-sm text-slate-900 tabular-nums">
          {formatMoney(budget.spentMinor, budget.currency, household.locale)}
          <span className="text-slate-400">
            {' '}/ {formatMoney(budget.amountMinor, budget.currency, household.locale)}
          </span>
        </span>
      </div>

      {/*
        Square at the baseline, rounded only at the data end. The fill is
        capped at 100% of the track so an overspend does not draw outside it —
        the number and the badge carry how far over it went.
      */}
      <div className="mt-2 h-2 w-full overflow-hidden rounded-sm bg-slate-100">
        <div
          className={cx(
            'h-full rounded-r-full',
            budget.state === 'over'
              ? 'bg-danger'
              : budget.state === 'approaching'
                ? 'bg-[color:var(--color-warning)]'
                : 'bg-brand-600',
          )}
          // A floor keeps a tiny-but-real amount visible, but zero has to read
          // as zero — a sliver where nothing was spent is a small lie.
          style={{ width: used === 0 ? '0%' : `${Math.min(100, Math.max(used, 1.5))}%` }}
          role="img"
          aria-label={`${name}: ${used.toFixed(0)} percent of the monthly limit used`}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <Badge tone={badge.tone} icon={badge.icon}>{badge.text}</Badge>
        <span className="text-xs text-slate-500 tabular-nums">
          {budget.remainingMinor >= 0
            ? `${formatMoney(budget.remainingMinor, budget.currency, household.locale)} left`
            : `${formatMoney(-budget.remainingMinor, budget.currency, household.locale)} over`}
        </span>
      </div>

      <div className="mt-2 flex justify-end">
        <Button
          variant="ghost"
          iconOnly
          aria-label={`Remove the ${name} budget`}
          loading={remove.isPending}
          onClick={() => {
            remove.mutate(budget.id, { onSuccess: () => toast.success('Budget removed') });
          }}
        >
          <Trash2 className="h-4 w-4 text-slate-400" />
        </Button>
      </div>
    </Card>
  );
}

function AddBudgetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const household = useHousehold();
  const toast = useToast();
  const createBudget = useCreateBudget(household.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const amountMinor = parseMoneyInput(amount, household.currency);
    if (amountMinor === null || amountMinor === 0) {
      setErrors({ amountMinor: 'Enter a monthly limit' });
      return;
    }

    const form = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = createBudgetSchema.safeParse({
      ...form,
      amountMinor,
      // An empty select means the household's overall limit.
      category: form.category === '' ? null : form.category,
    });

    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }

    try {
      await createBudget.mutateAsync(parsed.data);
      toast.success('Budget set');
      setAmount('');
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      toast.error(error instanceof ApiError ? error.message : 'Could not set that budget');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Set a monthly budget">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="What for?" error={errors.category}>
          {({ id }) => (
            <Select id={id} name="category" defaultValue="groceries">
              <option value="">Everything (overall limit)</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{label(c)}</option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={`Limit per month (${household.currency})`} error={errors.amountMinor} required>
          {({ id, invalid }) => (
            <Input
              id={id}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="50000"
              invalid={invalid}
              required
            />
          )}
        </Field>

        <Field
          label="Warn me at"
          error={errors.warnAtPercent}
          hint="We'll tell you before you cross the limit, not after."
        >
          {({ id }) => (
            <Select id={id} name="warnAtPercent" defaultValue="80">
              <option value="60">60% of the limit</option>
              <option value="75">75% of the limit</option>
              <option value="80">80% of the limit</option>
              <option value="90">90% of the limit</option>
            </Select>
          )}
        </Field>

        <Button type="submit" size="lg" loading={createBudget.isPending} className="w-full">
          Set budget
        </Button>
      </form>
    </Sheet>
  );
}
