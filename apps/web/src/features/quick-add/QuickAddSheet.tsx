/**
 * Quick add.
 *
 * This is not a convenience feature — it is the product's survival condition.
 * If capture takes longer than not capturing, the data rots within weeks
 * (docs/00). Target: under 15 seconds, four taps, with only required fields on
 * the primary path.
 */

import { useState, type FormEvent } from 'react';
import { Bell, CalendarPlus, ListTodo } from 'lucide-react';
import { addDays } from '@hms/shared';
import { useHousehold } from '../../app/session.js';
import { Button, Field, Input, Select, Sheet, cx } from '../../components/ui/index.js';
import { useToast } from '../../components/ui/toast.js';
import { ApiError } from '../../lib/api.js';
import { todayIn } from '../../lib/format.js';
import { useMembers } from '../family/api.js';
import { useCreateTask } from '../tasks/hooks.js';
import { useCreateEvent, useCreateReminder } from '../calendar/api.js';

type QuickAddKind = 'task' | 'reminder' | 'event';

const KINDS: Array<{ kind: QuickAddKind; label: string; icon: typeof ListTodo }> = [
  { kind: 'task', label: 'Task', icon: ListTodo },
  { kind: 'reminder', label: 'Reminder', icon: Bell },
  { kind: 'event', label: 'Event', icon: CalendarPlus },
];

export function QuickAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<QuickAddKind>('task');

  return (
    <Sheet open={open} onClose={onClose} title="Add something">
      <div className="mb-4 flex gap-2" role="tablist" aria-label="What are you adding?">
        {KINDS.map((option) => {
          const Icon = option.icon;
          const selected = kind === option.kind;
          return (
            <button
              key={option.kind}
              role="tab"
              aria-selected={selected}
              onClick={() => setKind(option.kind)}
              className={cx(
                'flex flex-1 touch-target flex-col items-center gap-1 rounded-lg border px-2 py-3 text-xs font-medium transition-colors',
                selected
                  ? 'border-brand-600 bg-brand-50 text-brand-900'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {option.label}
            </button>
          );
        })}
      </div>

      {kind === 'task' && <QuickAddTask onDone={onClose} />}
      {kind === 'reminder' && <QuickAddReminder onDone={onClose} />}
      {kind === 'event' && <QuickAddEvent onDone={onClose} />}
    </Sheet>
  );
}

/** Date chips beat a date picker for the three dates people actually pick. */
function DueDateChips({
  value,
  onChange,
  today,
}: {
  value: string;
  onChange: (next: string) => void;
  today: string;
}) {
  const options = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Next week', date: addDays(today, 7) },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={value === option.date}
          onClick={() => onChange(option.date)}
          className={cx(
            'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
            value === option.date
              ? 'bg-brand-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function useQuickAddState() {
  const household = useHousehold();
  const toast = useToast();
  const today = todayIn(household.timezone);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function reportError(error: unknown): void {
    if (error instanceof ApiError) {
      setFieldErrors(error.fieldErrors);
      if (!error.details?.length) toast.error(error.message);
      return;
    }
    toast.error('That didn’t save — please try again');
  }

  return { household, toast, today, fieldErrors, setFieldErrors, reportError };
}

function QuickAddTask({ onDone }: { onDone: () => void }) {
  const { household, toast, today, fieldErrors, setFieldErrors, reportError } = useQuickAddState();
  const members = useMembers(household.id);
  const createTask = useCreateTask(household.id);

  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(today);
  // Defaults to the person adding it: the commonest case, and one fewer tap.
  const [assigneeMemberId, setAssigneeMemberId] = useState(household.memberId);
  const [showMore, setShowMore] = useState(false);
  const [category, setCategory] = useState('other');
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFieldErrors({});

    try {
      await createTask.mutateAsync({
        title,
        dueDate,
        assigneeMemberId,
        category: category as never,
        priority: 'normal',
        ...(repeat !== 'none' ? { recurrence: { freq: repeat, interval: 1 } } : {}),
      } as never);
      toast.success('Task added');
      onDone();
    } catch (error) {
      reportError(error);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="What needs doing?" error={fieldErrors.title} required>
        {({ id, invalid }) => (
          <Input
            id={id}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Clean the water filter"
            autoComplete="off"
            invalid={invalid}
            required
          />
        )}
      </Field>

      <Field label="When" error={fieldErrors.dueDate}>
        {({ id }) => (
          <div className="space-y-2">
            <DueDateChips value={dueDate} onChange={setDueDate} today={today} />
            <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        )}
      </Field>

      <Field label="Who" error={fieldErrors.assigneeMemberId}>
        {({ id }) => (
          <Select id={id} value={assigneeMemberId} onChange={(e) => setAssigneeMemberId(e.target.value)}>
            {(members.data ?? []).map((member) => (
              <option key={member.id} value={member.id}>
                {member.isSelf ? `${member.displayName} (me)` : member.displayName}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {/* Advanced fields never sit on the primary path. */}
      {showMore ? (
        <div className="space-y-4 rounded-lg bg-slate-50 p-3">
          <Field label="Category">
            {({ id }) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                {['chore', 'cleaning', 'shopping', 'school', 'maintenance', 'finance', 'health', 'personal', 'other'].map((value) => (
                  <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Repeat">
            {({ id }) => (
              <Select id={id} value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
                <option value="none">Doesn’t repeat</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
              </Select>
            )}
          </Field>
        </div>
      ) : (
        <button type="button" onClick={() => setShowMore(true)} className="text-sm font-medium text-brand-700 underline">
          More details
        </button>
      )}

      <Button type="submit" size="lg" loading={createTask.isPending} className="w-full">
        Add task
      </Button>
    </form>
  );
}

function QuickAddReminder({ onDone }: { onDone: () => void }) {
  const { household, toast, today, fieldErrors, setFieldErrors, reportError } = useQuickAddState();
  const createReminder = useCreateReminder(household.id);

  const [title, setTitle] = useState('');
  const [remindOnDate, setRemindOnDate] = useState(today);
  const [remindAtTime, setRemindAtTime] = useState('09:00');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    try {
      await createReminder.mutateAsync({
        title,
        remindOnDate,
        remindAtTime,
        priority: 'normal',
      } as never);
      toast.success('Reminder set');
      onDone();
    } catch (error) {
      reportError(error);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Remind me to…" error={fieldErrors.title} required>
        {({ id, invalid }) => (
          <Input
            id={id}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Pay the electricity bill"
            invalid={invalid}
            required
          />
        )}
      </Field>

      <Field label="When" error={fieldErrors.remindOnDate}>
        {({ id }) => (
          <div className="space-y-2">
            <DueDateChips value={remindOnDate} onChange={setRemindOnDate} today={today} />
            <div className="flex gap-2">
              <Input id={id} type="date" value={remindOnDate} onChange={(e) => setRemindOnDate(e.target.value)} />
              <Input
                type="time"
                aria-label="Time"
                value={remindAtTime}
                onChange={(e) => setRemindAtTime(e.target.value)}
                className="w-32"
              />
            </div>
          </div>
        )}
      </Field>

      <Button type="submit" size="lg" loading={createReminder.isPending} className="w-full">
        Set reminder
      </Button>
    </form>
  );
}

function QuickAddEvent({ onDone }: { onDone: () => void }) {
  const { household, toast, today, fieldErrors, setFieldErrors, reportError } = useQuickAddState();
  const createEvent = useCreateEvent(household.id);

  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState('');
  const [eventType, setEventType] = useState('other');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    try {
      await createEvent.mutateAsync({
        title,
        startDate,
        eventType: eventType as never,
        participantMemberIds: [],
        ...(startTime ? { startTime } : {}),
      } as never);
      toast.success('Event added');
      onDone();
    } catch (error) {
      reportError(error);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="What’s happening?" error={fieldErrors.title} required>
        {({ id, invalid }) => (
          <Input
            id={id}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Zara’s birthday"
            invalid={invalid}
            required
          />
        )}
      </Field>

      <Field label="Date" error={fieldErrors.startDate} required>
        {({ id }) => <Input id={id} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />}
      </Field>

      <Field label="Time" hint="Leave empty for an all-day event">
        {({ id }) => <Input id={id} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
      </Field>

      <Field label="Type">
        {({ id }) => (
          <Select id={id} value={eventType} onChange={(e) => setEventType(e.target.value)}>
            {['birthday', 'anniversary', 'school', 'gathering', 'religious', 'holiday', 'trip', 'meeting', 'other'].map((value) => (
              <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>
            ))}
          </Select>
        )}
      </Field>

      <Button type="submit" size="lg" loading={createEvent.isPending} className="w-full">
        Add event
      </Button>
    </form>
  );
}
