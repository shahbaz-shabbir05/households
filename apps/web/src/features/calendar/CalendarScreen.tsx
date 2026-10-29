/**
 * The family calendar: month grid and agenda over one data set.
 *
 * Month is for orientation ("what does April look like?"); agenda is for
 * action ("what's coming up?"). Both read the same query, so switching views
 * costs nothing.
 */

import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDays,
  addMonths,
  civilParts,
  daysInMonth,
  isCivilDate,
  makeCivilDate,
  startOfMonth,
  startOfWeek,
  type CivilDate,
} from '@hms/shared';
import { useHousehold } from '../../app/session.js';
import { PageHeader } from '../../app/AppShell.js';
import { Button, Card, EmptyState, ErrorState, ListSkeleton, cx } from '../../components/ui/index.js';
import { friendlyDate, friendlyTime, monthLabel, todayIn } from '../../lib/format.js';
import { useEvents, type EventView } from './api.js';

type CalendarView = 'month' | 'agenda';

export function CalendarScreen() {
  const household = useHousehold();
  const [params, setParams] = useSearchParams();
  const today = todayIn(household.timezone);

  const view: CalendarView = params.get('view') === 'month' ? 'month' : 'agenda';
  // A URL is user input. An unvalidated value here reached Intl and
  // `civilParts`, both of which throw on a bad date — and with no error
  // boundary that unmounted the whole app and left a blank page.
  const monthParam = params.get('month');
  const anchor = monthParam && isCivilDate(monthParam) ? monthParam : startOfMonth(today);

  const range = useMemo(() => {
    if (view === 'agenda') return { from: today, to: addDays(today, 60) };
    const from = startOfWeek(startOfMonth(anchor), household.weekStartsOn);
    return { from, to: addDays(from, 41) }; // six weeks covers any month
  }, [view, anchor, today, household.weekStartsOn]);

  const query = useEvents(household.id, range);

  function setParam(key: string, value: string): void {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  }

  return (
    <div>
      <PageHeader title="Calendar" subtitle="Birthdays, school events, appointments and plans" />

      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex gap-2" role="tablist" aria-label="Calendar view">
          {(['agenda', 'month'] as const).map((option) => (
            <button
              key={option}
              role="tab"
              aria-selected={view === option}
              onClick={() => setParam('view', option)}
              className={cx(
                'rounded-full px-3.5 py-2 text-sm font-medium capitalize transition-colors',
                view === option
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
              )}
            >
              {option}
            </button>
          ))}
        </div>

        {view === 'month' && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              iconOnly
              aria-label="Previous month"
              onClick={() => setParam('month', addMonths(anchor, -1))}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="min-w-36 text-center text-sm font-medium text-slate-700">
              {monthLabel(anchor, household.locale)}
            </span>
            <Button
              variant="ghost"
              iconOnly
              aria-label="Next month"
              onClick={() => setParam('month', addMonths(anchor, 1))}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>

      {query.isPending ? (
        <ListSkeleton rows={4} />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'We could not load the calendar.'}
          onRetry={() => void query.refetch()}
        />
      ) : view === 'month' ? (
        <MonthGrid anchor={anchor} today={today} events={query.data.data} weekStartsOn={household.weekStartsOn} />
      ) : (
        <AgendaList events={query.data.data} today={today} locale={household.locale} />
      )}
    </div>
  );
}

function AgendaList({ events, today, locale }: { events: EventView[]; today: CivilDate; locale: string }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-10 w-10" />}
        title="Nothing coming up"
        description="Add birthdays, school events or appointments and they’ll show here — and on Today when they’re near."
      />
    );
  }

  // Grouped by day so the agenda reads as a list of days, not a list of rows.
  const byDate = new Map<CivilDate, EventView[]>();
  for (const event of events) {
    byDate.set(event.startDate, [...(byDate.get(event.startDate) ?? []), event]);
  }

  return (
    <div className="space-y-5">
      {[...byDate.entries()].map(([date, dayEvents]) => (
        <section key={date}>
          <h2 className="mb-2 px-1 text-sm font-semibold text-slate-600">
            {friendlyDate(date, today, locale)}
          </h2>
          <ul className="space-y-2">
            {dayEvents.map((event) => (
              <li key={event.id}>
                <Card className="flex items-start gap-3 p-3">
                  <span className="mt-0.5 w-14 shrink-0 text-xs font-medium text-slate-500">
                    {event.isAllDay || !event.startTime ? 'All day' : friendlyTime(event.startTime, locale)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{event.title}</p>
                    {event.location && <p className="truncate text-xs text-slate-500">{event.location}</p>}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MonthGrid({
  anchor,
  today,
  events,
  weekStartsOn,
}: {
  anchor: CivilDate;
  today: CivilDate;
  events: EventView[];
  weekStartsOn: 0 | 1;
}) {
  const { year, month } = civilParts(anchor);
  const gridStart = startOfWeek(makeCivilDate(year, month, 1), weekStartsOn);
  const cells = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const lastDay = daysInMonth(year, month);

  const byDate = new Map<CivilDate, EventView[]>();
  for (const event of events) {
    byDate.set(event.startDate, [...(byDate.get(event.startDate) ?? []), event]);
  }

  const weekdayLabels = weekStartsOn === 1
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <Card className="overflow-hidden p-2">
      <div className="grid grid-cols-7 gap-px">
        {weekdayLabels.map((label) => (
          <div key={label} className="px-1 py-2 text-center text-[11px] font-semibold text-slate-500">
            <span aria-hidden="true">{label.slice(0, 1)}</span>
            <span className="sr-only">{label}</span>
            <span className="hidden sm:inline" aria-hidden="true">{label.slice(1)}</span>
          </div>
        ))}

        {cells.map((date) => {
          const inMonth = civilParts(date).month === month && civilParts(date).day <= lastDay;
          const dayEvents = byDate.get(date) ?? [];
          const isToday = date === today;

          return (
            <div
              key={date}
              className={cx(
                'min-h-16 rounded-md p-1 text-left align-top sm:min-h-20',
                inMonth ? 'bg-white' : 'bg-slate-50 text-slate-300',
              )}
            >
              <span
                className={cx(
                  'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs',
                  isToday ? 'bg-brand-600 font-semibold text-white' : inMonth ? 'text-slate-700' : 'text-slate-300',
                )}
              >
                {civilParts(date).day}
              </span>
              <ul className="mt-0.5 space-y-0.5">
                {dayEvents.slice(0, 2).map((event) => (
                  <li
                    key={event.id}
                    className="truncate rounded bg-brand-100 px-1 py-0.5 text-[10px] text-brand-900"
                    title={event.title}
                  >
                    {event.title}
                  </li>
                ))}
                {dayEvents.length > 2 && (
                  <li className="px-1 text-[10px] text-slate-500">+{dayEvents.length - 2} more</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
