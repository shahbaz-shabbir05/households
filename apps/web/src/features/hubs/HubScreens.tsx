/**
 * Section hubs.
 *
 * Each hub lists what the section contains, and says plainly what has not been
 * built yet. An honest "coming next" beats a dead link or a screen of zeros.
 */

import { Link } from 'react-router-dom';
import {
  Boxes,
  CalendarClock,
  ChevronRight,
  ListTodo,
  PiggyBank,
  Receipt,
  ShoppingCart,
  Wrench,
} from 'lucide-react';
import { PageHeader } from '../../app/AppShell.js';
import { Card, cx } from '../../components/ui/index.js';

interface HubEntry {
  to?: string;
  label: string;
  description: string;
  icon: typeof ListTodo;
  /** Present when the module has not shipped yet. */
  phase?: string;
}

function HubList({ entries }: { entries: HubEntry[] }) {
  return (
    <ul className="space-y-2">
      {entries.map((entry) => {
        const Icon = entry.icon;
        const content = (
          <Card
            className={cx(
              'flex items-center gap-3 p-4',
              entry.to ? 'transition-colors hover:bg-slate-50' : 'opacity-70',
            )}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">{entry.label}</p>
              <p className="text-xs text-slate-500">{entry.description}</p>
            </div>
            {entry.to ? (
              <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
            ) : (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                {entry.phase}
              </span>
            )}
          </Card>
        );

        return <li key={entry.label}>{entry.to ? <Link to={entry.to}>{content}</Link> : content}</li>;
      })}
    </ul>
  );
}

export function HomeHubScreen() {
  return (
    <div>
      <PageHeader title="Home" subtitle="The house itself — what needs doing and what you keep in it" />
      <HubList
        entries={[
          {
            to: '/home/tasks',
            label: 'Tasks & chores',
            description: 'Everything that needs doing, and who is doing it',
            icon: ListTodo,
          },
          {
            label: 'Shopping & inventory',
            description: 'What you have, what is running low, and the list',
            icon: ShoppingCart,
            phase: 'Phase 3',
          },
          {
            label: 'Maintenance',
            description: 'Servicing, repairs and what is due next',
            icon: Wrench,
            phase: 'Phase 6',
          },
          {
            label: 'Appliances & assets',
            description: 'Warranties, serial numbers and service history',
            icon: Boxes,
            phase: 'Phase 6',
          },
        ]}
      />
    </div>
  );
}

export function MoneyHubScreen() {
  return (
    <div>
      <PageHeader title="Money" subtitle="What you owe, and what you have spent" />
      <HubList
        entries={[
          {
            label: 'Bills',
            description: 'Utilities, rent and subscriptions — due, overdue and paid',
            icon: CalendarClock,
            phase: 'Phase 4',
          },
          {
            label: 'Expenses',
            description: 'Where the money went, by category and by person',
            icon: Receipt,
            phase: 'Phase 4',
          },
          {
            label: 'Budgets',
            description: 'Monthly limits, with a warning before you cross them',
            icon: PiggyBank,
            phase: 'Phase 4',
          },
        ]}
      />
      <p className="mt-4 px-1 text-xs text-slate-500">
        Bills and expenses are next. Until then, a reminder is a reasonable
        stand-in for a due date you cannot afford to miss.
      </p>
    </div>
  );
}
