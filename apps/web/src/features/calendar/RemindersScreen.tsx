import { Bell, Clock } from 'lucide-react';
import { useHousehold } from '../../app/session.js';
import { PageHeader } from '../../app/AppShell.js';
import { Badge, Button, Card, EmptyState, ErrorState, ListSkeleton, cx } from '../../components/ui/index.js';
import { useToast } from '../../components/ui/toast.js';
import { friendlyDate, friendlyTime, todayIn } from '../../lib/format.js';
import { useDismissReminder, useReminders, useSnoozeReminder } from './api.js';

export function RemindersScreen() {
  const household = useHousehold();
  const toast = useToast();
  const query = useReminders(household.id, { status: 'pending' });
  const dismiss = useDismissReminder(household.id);
  const snooze = useSnoozeReminder(household.id);
  const today = todayIn(household.timezone);

  return (
    <div>
      <PageHeader title="Reminders" subtitle="Anything you want the app to nudge you about" />

      {query.isPending ? (
        <ListSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'We could not load your reminders.'}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-10 w-10" />}
          title="No reminders set"
          description="Set one for anything with a date — a bill, a renewal, a medicine — and we’ll tell you in time."
        />
      ) : (
        <ul className="space-y-2">
          {query.data.data.map((reminder) => {
            const overdue = reminder.remindOnDate < today;
            return (
              <li key={reminder.id}>
                <Card className={cx('p-3', overdue && 'ring-danger/30')}>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <Bell className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{reminder.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {friendlyDate(reminder.remindOnDate, today, household.locale)} ·{' '}
                        {friendlyTime(reminder.remindAtTime, household.locale)}
                        {reminder.assigneeName && ` · ${reminder.assigneeName}`}
                      </p>
                      {overdue && (
                        <p className="mt-1.5">
                          <Badge tone="danger" icon={<Clock className="h-3 w-3" aria-hidden="true" />}>Past due</Badge>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={snooze.isPending}
                      onClick={() => {
                        snooze.mutate(
                          { reminderId: reminder.id, minutes: 60 },
                          { onSuccess: () => toast.success('Snoozed for an hour') },
                        );
                      }}
                    >
                      Snooze 1 hour
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={dismiss.isPending}
                      onClick={() => {
                        dismiss.mutate(reminder.id, { onSuccess: () => toast.success('Dismissed') });
                      }}
                    >
                      Dismiss
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
