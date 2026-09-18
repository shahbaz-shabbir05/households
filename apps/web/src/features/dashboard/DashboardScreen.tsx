/**
 * "Today" — the dashboard, and the reason the product exists.
 *
 * Ranking rather than configurability is how it prioritises: overdue first,
 * then urgency, then time (docs/16 §B.5). Sections that are empty are absent,
 * not shown as a row of zeros.
 */

import { AlertTriangle, CalendarClock, CheckCircle2, Clock, ListTodo, Bell, PartyPopper } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { EntityType } from '@hms/shared';
import { useHousehold, useSession } from '../../app/session.js';
import { Badge, Card, EmptyState, ErrorState, ListSkeleton, SectionHeading, cx } from '../../components/ui/index.js';
import { useToast } from '../../components/ui/toast.js';
import { friendlyDate, friendlyTime, longDate, overdueLabel } from '../../lib/format.js';
import { useToggleTask } from '../tasks/hooks.js';
import { useDismissReminder } from '../calendar/api.js';
import { useDashboard, type DashboardItem } from './api.js';

const ENTITY_ICONS: Partial<Record<EntityType, typeof ListTodo>> = {
  task: ListTodo,
  reminder: Bell,
  event: PartyPopper,
  bill: CalendarClock,
};

export function DashboardScreen() {
  const household = useHousehold();
  const { user } = useSession();
  const { data, isPending, isError, error, refetch, isFetching } = useDashboard(household.id);

  if (isPending) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48" />
        <ListSkeleton rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'We could not load your dashboard.'}
        onRetry={() => void refetch()}
      />
    );
  }

  const nothingToShow =
    data.needsAttention.length === 0 && data.today.length === 0 && data.thisWeek.length === 0;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">{longDate(data.window.today, household.locale)}</p>
        <h1 className="mt-0.5 text-2xl font-semibold text-slate-900">
          {greeting()}, {user?.displayName?.split(' ')[0] ?? 'there'}
        </h1>
        {/* Stale data stays on screen with a quiet indicator, rather than being
            replaced by a spinner. */}
        {isFetching && <p className="mt-1 text-xs text-slate-400">Refreshing…</p>}
      </header>

      {nothingToShow ? (
        <EmptyState
          icon={<CheckCircle2 className="h-10 w-10" />}
          title="Nothing needs you right now"
          description="When you add tasks, reminders, bills or events, whatever is due will appear here first."
          action={
            <Link
              to="/home/tasks"
              className="inline-flex h-11 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
            >
              Add your first task
            </Link>
          }
        />
      ) : (
        <>
          {data.needsAttention.length > 0 && (
            <section aria-labelledby="needs-attention">
              <SectionHeading title="Needs attention" count={data.counts.needsAttention} />
              <div className="space-y-2">
                {data.needsAttention.map((item) => (
                  <ItemRow key={`${item.entityType}-${item.id}`} item={item} today={data.window.today} locale={household.locale} />
                ))}
              </div>
            </section>
          )}

          {data.today.length > 0 && (
            <section aria-labelledby="today">
              <SectionHeading title="Today" count={data.counts.today} />
              <div className="space-y-2">
                {data.today.map((item) => (
                  <ItemRow key={`${item.entityType}-${item.id}`} item={item} today={data.window.today} locale={household.locale} />
                ))}
              </div>
            </section>
          )}

          {data.thisWeek.length > 0 && (
            <section aria-labelledby="this-week">
              <SectionHeading title="This week" count={data.counts.thisWeek} />
              <div className="space-y-2">
                {data.thisWeek.map((item) => (
                  <ItemRow key={`${item.entityType}-${item.id}`} item={item} today={data.window.today} locale={household.locale} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A dashboard row is actionable *in place*: ticking a task or dismissing a
 * reminder must not require navigating away and back (docs/02 §J2).
 */
function ItemRow({ item, today, locale }: { item: DashboardItem; today: string; locale: string }) {
  const household = useHousehold();
  const toast = useToast();
  const toggleTask = useToggleTask(household.id);
  const dismissReminder = useDismissReminder(household.id);

  const Icon = ENTITY_ICONS[item.entityType] ?? Clock;
  const isTask = item.entityType === 'task';
  const isReminder = item.entityType === 'reminder';

  async function onAct() {
    try {
      if (isTask) {
        await toggleTask.mutateAsync({ taskId: item.id, completed: true });
        toast.success('Done');
      } else if (isReminder) {
        await dismissReminder.mutateAsync(item.id);
        toast.success('Dismissed');
      }
    } catch {
      toast.error('That didn’t save — please try again');
    }
  }

  const busy = toggleTask.isPending || dismissReminder.isPending;

  return (
    <Card className={cx('flex items-center gap-3 p-3', item.isOverdue && 'ring-danger/30')}>
      {(isTask || isReminder) ? (
        <button
          onClick={() => void onAct()}
          disabled={busy}
          aria-label={isTask ? `Mark "${item.title}" as done` : `Dismiss "${item.title}"`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-2 ring-slate-300 transition-colors hover:bg-brand-50 hover:ring-brand-500 disabled:opacity-50"
        >
          <CheckCircle2 className="h-5 w-5 text-transparent hover:text-brand-600" aria-hidden="true" />
        </button>
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>{friendlyDate(item.date, today, locale)}</span>
          {item.time && <span>· {friendlyTime(item.time, locale)}</span>}
          {item.subtitle && <span className="truncate">· {item.subtitle}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {item.isOverdue && (
          // Colour is never the only signal: the icon and the words carry it too.
          <Badge tone="danger" icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}>
            {overdueLabel(item.date, today) || 'Overdue'}
          </Badge>
        )}
        {!item.isOverdue && item.priority === 'urgent' && <Badge tone="warning">Urgent</Badge>}
      </div>
    </Card>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
