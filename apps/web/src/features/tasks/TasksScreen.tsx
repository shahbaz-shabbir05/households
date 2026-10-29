/**
 * Tasks and chores.
 *
 * One list, with chores as a saved view rather than a second destination — a
 * user thinking "what do I have to do?" wants one place (docs/03).
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, ListTodo, Repeat, Trash2, User } from 'lucide-react';
import { useHousehold } from '../../app/session.js';
import { PageHeader } from '../../app/AppShell.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  ListSkeleton,
  Select,
  cx,
} from '../../components/ui/index.js';
import { useToast } from '../../components/ui/toast.js';
import { friendlyDate, friendlyTime, overdueLabel, todayIn } from '../../lib/format.js';
import { useDeleteTask, useTasks, useToggleTask } from './hooks.js';
import type { TaskFilters, TaskView } from './api.js';

const VIEWS = [
  { key: 'open', label: 'To do', filters: { open: true } },
  { key: 'mine', label: 'Mine', filters: { open: true, assignee: 'me' as const } },
  { key: 'chores', label: 'Chores', filters: { open: true, category: 'chore' as const } },
  { key: 'overdue', label: 'Overdue', filters: { overdue: true } },
  { key: 'done', label: 'Done', filters: { status: 'completed' as const } },
];

export function TasksScreen() {
  const household = useHousehold();
  const [params, setParams] = useSearchParams();
  // View and search live in the URL, so the back button and a shared link both
  // behave the way a user expects (docs/11).
  const view = params.get('view') ?? 'open';
  const search = params.get('q') ?? '';

  const activeView = VIEWS.find((v) => v.key === view) ?? VIEWS[0]!;
  const filters: TaskFilters = {
    ...activeView.filters,
    ...(search ? { search } : {}),
    sort: 'dueDate',
    order: 'asc',
    perPage: 50,
  };

  const query = useTasks(household.id, filters);
  const today = todayIn(household.timezone);

  function setParam(key: string, value: string): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return (
    <div>
      <PageHeader title="Tasks & chores" subtitle="Everything the household needs to get done" />

      <div className="mb-4 space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Task views">
          {VIEWS.map((option) => (
            <button
              key={option.key}
              role="tab"
              aria-selected={view === option.key}
              onClick={() => setParam('view', option.key)}
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

        <div className="flex gap-2">
          <label htmlFor="task-search" className="sr-only">Search tasks</label>
          <Input
            id="task-search"
            type="search"
            value={search}
            onChange={(event) => setParam('q', event.target.value)}
            placeholder="Search tasks"
          />
        </div>
      </div>

      {query.isPending ? (
        <ListSkeleton rows={5} />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'We could not load your tasks.'}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          icon={<ListTodo className="h-10 w-10" />}
          title={search ? 'Nothing matched' : emptyTitle(view)}
          description={
            search
              ? 'Try a different word, or clear the search.'
              : 'Use the + button to add one — we’ll show it here and on Today when it’s due.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {query.data.data.map((task) => (
            <li key={task.id}>
              <TaskRow task={task} today={today} locale={household.locale} />
            </li>
          ))}
        </ul>
      )}

      {query.data && query.data.meta.total > query.data.data.length && (
        <p className="mt-4 text-center text-sm text-slate-500">
          Showing {query.data.data.length} of {query.data.meta.total}
        </p>
      )}
    </div>
  );
}

function TaskRow({ task, today, locale }: { task: TaskView; today: string; locale: string }) {
  const household = useHousehold();
  const toast = useToast();
  const toggle = useToggleTask(household.id);
  const remove = useDeleteTask(household.id);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const done = task.status === 'completed';

  async function onToggle() {
    try {
      await toggle.mutateAsync({ taskId: task.id, completed: !done });
    } catch {
      toast.error('That didn’t save — please try again');
    }
  }

  async function onDelete(scope: 'occurrence' | 'following') {
    try {
      await remove.mutateAsync({ taskId: task.id, scope });
      toast.success(scope === 'following' ? 'Deleted this and future repeats' : 'Task deleted');
    } catch {
      toast.error('Could not delete that task');
    } finally {
      setConfirmingDelete(false);
    }
  }

  return (
    <Card className={cx('p-3', task.isOverdue && 'ring-danger/30')}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => void onToggle()}
          disabled={toggle.isPending}
          aria-label={done ? `Reopen "${task.title}"` : `Mark "${task.title}" as done`}
          className={cx(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 transition-colors',
            done ? 'bg-brand-600 ring-brand-600 text-white' : 'ring-slate-300 hover:ring-brand-500',
          )}
        >
          {done && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
        </button>

        <div className="min-w-0 flex-1">
          <p className={cx('text-sm font-medium', done ? 'text-slate-400 line-through' : 'text-slate-900')}>
            {task.title}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            {task.dueDate && (
              <span className={cx(task.isOverdue && 'font-medium text-danger')}>
                {friendlyDate(task.dueDate, today, locale)}
                {task.dueTime && ` · ${friendlyTime(task.dueTime, locale)}`}
              </span>
            )}
            {task.assigneeName && (
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" aria-hidden="true" />
                {task.assigneeName}
              </span>
            )}
            {task.isRecurring && (
              <span className="inline-flex items-center gap-1">
                <Repeat className="h-3 w-3" aria-hidden="true" />
                Repeats
              </span>
            )}
          </div>

          {task.isOverdue && !done && (
            <p className="mt-1.5">
              <Badge tone="danger">{overdueLabel(task.dueDate!, today)}</Badge>
            </p>
          )}
        </div>

        <Button
          variant="ghost"
          iconOnly
          onClick={() => setConfirmingDelete(true)}
          aria-label={`Delete "${task.title}"`}
        >
          <Trash2 className="h-4 w-4 text-slate-400" />
        </Button>
      </div>

      {/* Deleting is confirmed inline, and a repeating task asks what "delete"
          should mean before doing anything (docs/08). */}
      {confirmingDelete && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3">
          <p className="text-sm text-slate-700">
            {task.isRecurring ? 'This task repeats. What would you like to delete?' : 'Delete this task?'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={() => void onDelete('occurrence')} loading={remove.isPending}>
              {task.isRecurring ? 'Just this one' : 'Delete'}
            </Button>
            {task.isRecurring && (
              <Button size="sm" variant="danger" onClick={() => void onDelete('following')} loading={remove.isPending}>
                This and future
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function emptyTitle(view: string): string {
  switch (view) {
    case 'overdue':
      return 'Nothing is overdue';
    case 'done':
      return 'Nothing completed yet';
    case 'chores':
      return 'No chores yet';
    case 'mine':
      return 'Nothing assigned to you';
    default:
      return 'No tasks yet';
  }
}
