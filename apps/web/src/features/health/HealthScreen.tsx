/**
 * Health — today's doses and what is coming up.
 *
 * The screen is built around one sentence from the spec (§9): this is record
 * keeping and reminders, not a medical decision-making system. So every dose is
 * shown with the prescription's own wording beside it, and the only two things
 * you can do to a dose are say it was taken or say it was skipped. There is no
 * "adjust", no "snooze to a different amount", and no advice anywhere.
 */

import { Link } from 'react-router-dom';
import {
  CalendarClock,
  Check,
  ChevronRight,
  Pill,
  Stethoscope,
  X,
} from 'lucide-react';
import { useHousehold } from '../../app/session.js';
import { PageHeader } from '../../app/AppShell.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListSkeleton,
  cx,
} from '../../components/ui/index.js';
import { useToast } from '../../components/ui/toast.js';
import { friendlyDate, friendlyTime, todayIn } from '../../lib/format.js';
import { useAppointments, useDoses, useRecordDose, type DoseView } from './api.js';

export function HealthScreen() {
  const household = useHousehold();
  const today = todayIn(household.timezone);
  const doses = useDoses(household.id, { from: today, to: today });
  const appointments = useAppointments(household.id, { upcoming: true, perPage: '5' });

  return (
    <div>
      <PageHeader title="Health" subtitle="Doses, appointments and who prescribed what" />

      <nav aria-label="Health sections" className="mb-5 grid grid-cols-2 gap-2">
        <SectionLink to="/family/health/medicines" label="Medicines" icon={Pill} />
        <SectionLink to="/family/health/appointments" label="Appointments" icon={Stethoscope} />
      </nav>

      <h2 className="mb-2 text-sm font-semibold text-slate-900">Today's doses</h2>

      {doses.isPending ? (
        <ListSkeleton rows={3} />
      ) : doses.isError ? (
        <ErrorState
          message={doses.error instanceof Error ? doses.error.message : 'We could not load today.'}
          onRetry={() => void doses.refetch()}
        />
      ) : doses.data.length === 0 ? (
        <EmptyState
          icon={<Pill className="h-10 w-10" />}
          title="Nothing due today"
          description="Add a medicine with the times you want reminding, and its doses will appear here."
        />
      ) : (
        <ul className="space-y-2">
          {doses.data.map((dose) => (
            <li key={dose.id}>
              <DoseRow dose={dose} />
            </li>
          ))}
        </ul>
      )}

      {appointments.data && appointments.data.data.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-900">Coming up</h2>
          <ul className="space-y-2">
            {appointments.data.data.map((appointment) => (
              <li key={appointment.id}>
                <Card className="flex items-center gap-3 p-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {appointment.doctorName ?? 'Appointment'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {friendlyDate(appointment.scheduledOn, today, household.locale)}
                      {appointment.scheduledAtTime &&
                        ` at ${friendlyTime(appointment.scheduledAtTime, household.locale)}`}
                      {appointment.memberName && ` · ${appointment.memberName}`}
                    </p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SectionLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof Pill;
}) {
  return (
    <Link to={to}>
      <Card className="flex items-center gap-2 p-3 transition-colors hover:bg-slate-50">
        <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <span className="flex-1 text-sm font-medium text-slate-900">{label}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      </Card>
    </Link>
  );
}

const DOSE_TONE = {
  due: 'bg-slate-100 text-slate-500',
  taken: 'bg-success-bg text-success',
  skipped: 'bg-slate-100 text-slate-400',
  missed: 'bg-danger-bg text-danger',
} as const;

/**
 * One dose. The medicine's own dose text sits on the row, so what is on the
 * screen matches what is written on the box — the app never restates it.
 */
export function DoseRow({ dose }: { dose: DoseView }) {
  const household = useHousehold();
  const toast = useToast();
  const record = useRecordDose(household.id);
  const settled = dose.status !== 'due' && dose.status !== 'missed';

  function onRecord(status: 'taken' | 'skipped') {
    record.mutate(
      { doseId: dose.id, input: { status, decrementStock: true } },
      {
        onSuccess: () => toast.success(status === 'taken' ? 'Recorded as taken' : 'Recorded as skipped'),
        onError: () => toast.error('Could not record that'),
      },
    );
  }

  return (
    <Card className={cx('p-3', dose.status === 'missed' && 'ring-danger/30')}>
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            DOSE_TONE[dose.status],
          )}
        >
          {dose.status === 'taken' ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : dose.status === 'skipped' ? (
            <X className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Pill className="h-4 w-4" aria-hidden="true" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className={cx('truncate text-sm font-medium', settled ? 'text-slate-500' : 'text-slate-900')}>
            {dose.medicineName}
          </p>
          {/* Verbatim from the prescription. */}
          <p className="truncate text-xs text-slate-600">{dose.doseText}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            <span>{friendlyTime(dose.scheduledAtTime, household.locale)}</span>
            {dose.memberName && <span>· {dose.memberName}</span>}
          </div>
          {dose.status === 'missed' && (
            <p className="mt-1.5">
              <Badge tone="danger">Missed</Badge>
            </p>
          )}
          {dose.status === 'skipped' && (
            <p className="mt-1.5">
              <Badge tone="neutral">Skipped</Badge>
            </p>
          )}
          {dose.status === 'taken' && (
            <p className="mt-1.5">
              <Badge tone="success">Taken</Badge>
            </p>
          )}
        </div>

        {!settled && (
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" loading={record.isPending} onClick={() => onRecord('taken')}>
              Taken
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onRecord('skipped')}>
              Skip
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
