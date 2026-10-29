/**
 * Appointments.
 *
 * Two things matter here. Before the visit: who, when, where, and a reminder in
 * good time. After it: what the doctor actually said, stored in the household's
 * own words. The app never summarises or interprets that note — it is a record,
 * and a paraphrase of medical advice is a liability (§9).
 */

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, MapPin, NotebookPen, Plus, Repeat, Stethoscope, Trash2 } from 'lucide-react';
import { createAppointmentSchema } from '@hms/shared';
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
  Textarea,
  cx,
} from '../../components/ui/index.js';
import { useToast } from '../../components/ui/toast.js';
import { ApiError } from '../../lib/api.js';
import { friendlyDate, friendlyTime, todayIn } from '../../lib/format.js';
import { useMembers } from '../family/api.js';
import {
  useAppointments,
  useCreateAppointment,
  useDeleteAppointment,
  useUpdateAppointment,
  type AppointmentView,
} from './api.js';

const VIEWS = [
  { key: 'upcoming', label: 'Upcoming', filters: { upcoming: true } },
  { key: 'past', label: 'Past', filters: { status: 'completed' } },
  { key: 'all', label: 'All', filters: {} },
] as const;

export function AppointmentsScreen() {
  const household = useHousehold();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'upcoming';
  const [addOpen, setAddOpen] = useState(false);
  const [recording, setRecording] = useState<AppointmentView | null>(null);

  const active = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  const query = useAppointments(household.id, active.filters);
  const today = todayIn(household.timezone);

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle="Who you're seeing, and what came of it"
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        }
      />

      <div
        className="mb-4 flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Appointment views"
      >
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

      {query.isPending ? (
        <ListSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState
          message={
            query.error instanceof Error ? query.error.message : 'We could not load appointments.'
          }
          onRetry={() => void query.refetch()}
        />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          icon={<Stethoscope className="h-10 w-10" />}
          title={view === 'past' ? 'Nothing recorded yet' : 'No appointments booked'}
          description="Add one and we'll remind you the day before — and give you somewhere to write down what was said."
          action={<Button onClick={() => setAddOpen(true)}>Add an appointment</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {query.data.data.map((appointment) => (
            <li key={appointment.id}>
              <AppointmentRow
                appointment={appointment}
                today={today}
                onRecord={() => setRecording(appointment)}
              />
            </li>
          ))}
        </ul>
      )}

      <AddAppointmentSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <OutcomeSheet appointment={recording} onClose={() => setRecording(null)} />
    </div>
  );
}

function AppointmentRow({
  appointment,
  today,
  onRecord,
}: {
  appointment: AppointmentView;
  today: string;
  onRecord: () => void;
}) {
  const household = useHousehold();
  const toast = useToast();
  const remove = useDeleteAppointment(household.id);
  const [confirming, setConfirming] = useState(false);

  const isDone = appointment.status === 'completed';
  const isCancelled = appointment.status === 'cancelled';

  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            isDone ? 'bg-success-bg text-success' : 'bg-slate-100 text-slate-500',
          )}
        >
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={cx(
              'truncate text-sm font-medium',
              isCancelled ? 'text-slate-400 line-through' : isDone ? 'text-slate-500' : 'text-slate-900',
            )}
          >
            {appointment.doctorName ?? 'Appointment'}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>
              {friendlyDate(appointment.scheduledOn, today, household.locale)}
              {appointment.scheduledAtTime &&
                ` at ${friendlyTime(appointment.scheduledAtTime, household.locale)}`}
            </span>
            {appointment.memberName && <span>· {appointment.memberName}</span>}
            {appointment.isRecurring && (
              <span className="inline-flex items-center gap-1">
                <Repeat className="h-3 w-3" aria-hidden="true" />
                Repeats
              </span>
            )}
          </div>

          {appointment.reason && <p className="mt-1 text-xs text-slate-600">{appointment.reason}</p>}

          {appointment.location && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {appointment.location}
            </p>
          )}

          {/* Verbatim, with no summary layered over it. */}
          {appointment.outcomeNotes && (
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
              {appointment.outcomeNotes}
            </p>
          )}

          {appointment.followUpOn && (
            <p className="mt-1.5">
              <Badge tone="brand">
                Follow up {friendlyDate(appointment.followUpOn, today, household.locale)}
              </Badge>
            </p>
          )}
          {isCancelled && (
            <p className="mt-1.5">
              <Badge tone="neutral">Cancelled</Badge>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {!isCancelled && (
            <Button size="sm" variant="secondary" onClick={onRecord}>
              <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
              {isDone ? 'Notes' : 'Record'}
            </Button>
          )}
          <Button
            variant="ghost"
            iconOnly
            aria-label={`Delete appointment with ${appointment.doctorName ?? 'doctor'}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="h-4 w-4 text-slate-400" />
          </Button>
        </div>
      </div>

      {confirming && (
        <div className="mt-2 rounded-lg bg-slate-50 p-3">
          <p className="text-sm text-slate-700">Delete this appointment?</p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                remove.mutate(appointment.id, {
                  onSuccess: () => toast.success('Appointment deleted'),
                  onSettled: () => setConfirming(false),
                });
              }}
            >
              Delete
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** What was said at the visit, and anything booked off the back of it. */
function OutcomeSheet({
  appointment,
  onClose,
}: {
  appointment: AppointmentView | null;
  onClose: () => void;
}) {
  const household = useHousehold();
  const toast = useToast();
  const update = useUpdateAppointment(household.id);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!appointment) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    if (!appointment) return;

    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

    try {
      await update.mutateAsync({
        appointmentId: appointment.id,
        input: {
          status: form['status'] as never,
          outcomeNotes: form['outcomeNotes'] ?? '',
          followUpOn: form['followUpOn'] ?? '',
        } as never,
      });
      toast.success('Saved');
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      toast.error(error instanceof ApiError ? error.message : 'Could not save that');
    }
  }

  return (
    <Sheet open onClose={onClose} title="After the appointment">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="What happened?">
          {({ id }) => (
            <Select id={id} name="status" defaultValue={appointment.status}>
              <option value="completed">We went</option>
              <option value="cancelled">Cancelled</option>
              <option value="rescheduled">Rescheduled</option>
              <option value="scheduled">Still booked</option>
            </Select>
          )}
        </Field>

        <Field
          label="What did the doctor say?"
          error={errors.outcomeNotes}
          hint="In their words or yours — we store it exactly as you type it and never interpret it."
        >
          {({ id }) => (
            <Textarea
              id={id}
              name="outcomeNotes"
              rows={5}
              defaultValue={appointment.outcomeNotes ?? ''}
              placeholder="Continue the current course. Review in 6 weeks if no better."
            />
          )}
        </Field>

        <Field label="Follow up on" error={errors.followUpOn} hint="Optional — we'll remind you">
          {({ id }) => (
            <Input
              id={id}
              name="followUpOn"
              type="date"
              defaultValue={appointment.followUpOn ?? ''}
            />
          )}
        </Field>

        <Button type="submit" size="lg" loading={update.isPending} className="w-full">
          Save
        </Button>
      </form>
    </Sheet>
  );
}

function AddAppointmentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const household = useHousehold();
  const toast = useToast();
  const create = useCreateAppointment(household.id);
  const members = useMembers(household.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [repeats, setRepeats] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = createAppointmentSchema.safeParse({
      ...form,
      ...(repeats ? { recurrence: { freq: 'monthly', interval: 1 } } : {}),
    });

    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }

    try {
      await create.mutateAsync(parsed.data);
      toast.success('Appointment added');
      setRepeats(false);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      toast.error(error instanceof ApiError ? error.message : 'Could not add that appointment');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add an appointment">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Who is it for?" error={errors.memberId} required>
          {({ id }) => (
            <Select id={id} name="memberId" required defaultValue="">
              <option value="" disabled>
                Choose someone
              </option>
              {(members.data ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Who are you seeing?"
          error={errors.doctorName}
          hint="We'll remember them for next time"
        >
          {({ id }) => <Input id={id} name="doctorName" placeholder="Dr Saleem" />}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" error={errors.scheduledOn} required>
            {({ id }) => (
              <Input
                id={id}
                name="scheduledOn"
                type="date"
                defaultValue={todayIn(household.timezone)}
                required
              />
            )}
          </Field>
          <Field label="Time" error={errors.scheduledAtTime} hint="Optional">
            {({ id }) => <Input id={id} name="scheduledAtTime" type="time" />}
          </Field>
        </div>

        <Field label="What for?" error={errors.reason} hint="Optional">
          {({ id }) => <Input id={id} name="reason" placeholder="Annual check-up" />}
        </Field>

        <Field label="Where?" error={errors.location} hint="Optional">
          {({ id }) => <Input id={id} name="location" placeholder="Aga Khan, Clifton" />}
        </Field>

        <Field label="Remind me this many days before" error={errors.remindDaysBefore}>
          {({ id }) => (
            <Select id={id} name="remindDaysBefore" defaultValue="1">
              <option value="0">On the day</option>
              <option value="1">1 day before</option>
              <option value="2">2 days before</option>
              <option value="7">A week before</option>
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
          This repeats every month
        </label>

        <Button type="submit" size="lg" loading={create.isPending} className="w-full">
          Add appointment
        </Button>
      </form>
    </Sheet>
  );
}
