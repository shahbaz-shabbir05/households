/**
 * Medicines.
 *
 * The form deliberately asks for the dose and the frequency as *text*, and for
 * reminder times as an explicit list. It would be easy to offer "twice daily"
 * as a dropdown and generate 09:00/21:00 from it — and wrong: the app would be
 * deciding when a medicine is taken. The household types what the box says and
 * picks the times itself (§9, docs/16).
 */

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, PackagePlus, Pill, Plus, Trash2 } from 'lucide-react';
import { createMedicineSchema } from '@hms/shared';
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
import { friendlyTime, longDate, todayIn } from '../../lib/format.js';
import { useMembers } from '../family/api.js';
import {
  useCreateMedicine,
  useDeleteMedicine,
  useMedicines,
  useRefillMedicine,
  type MedicineView,
} from './api.js';

const VIEWS = [
  { key: 'active', label: 'Current', filters: { active: true } },
  { key: 'refill', label: 'Running low', filters: { needsRefill: true } },
  { key: 'all', label: 'All', filters: {} },
] as const;

export function MedicinesScreen() {
  const household = useHousehold();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? 'active';
  const [addOpen, setAddOpen] = useState(false);
  const [refilling, setRefilling] = useState<MedicineView | null>(null);

  const active = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  const query = useMedicines(household.id, active.filters);

  return (
    <div>
      <PageHeader
        title="Medicines"
        subtitle="What's being taken, and when to remind"
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        }
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Medicine views">
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
            query.error instanceof Error ? query.error.message : 'We could not load your medicines.'
          }
          onRetry={() => void query.refetch()}
        />
      ) : query.data.data.length === 0 ? (
        <EmptyState
          icon={<Pill className="h-10 w-10" />}
          title={view === 'refill' ? 'Nothing is running low' : 'No medicines yet'}
          description="Copy what the prescription says, pick the times you want reminding, and we'll do the reminding."
          action={<Button onClick={() => setAddOpen(true)}>Add a medicine</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {query.data.data.map((medicine) => (
            <li key={medicine.id}>
              <MedicineRow medicine={medicine} onRefill={() => setRefilling(medicine)} />
            </li>
          ))}
        </ul>
      )}

      <AddMedicineSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <RefillSheet medicine={refilling} onClose={() => setRefilling(null)} />
    </div>
  );
}

function MedicineRow({
  medicine,
  onRefill,
}: {
  medicine: MedicineView;
  onRefill: () => void;
}) {
  const household = useHousehold();
  const toast = useToast();
  const remove = useDeleteMedicine(household.id);
  const [confirming, setConfirming] = useState(false);

  return (
    <Card className={cx('p-3', medicine.needsRefill && 'ring-warning/30')}>
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            medicine.isActive ? 'bg-brand-100 text-brand-900' : 'bg-slate-100 text-slate-400',
          )}
        >
          <Pill className="h-4 w-4" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={cx(
              'truncate text-sm font-medium',
              medicine.isActive ? 'text-slate-900' : 'text-slate-500',
            )}
          >
            {medicine.name}
          </p>
          {/* Both of these are shown exactly as they were entered. */}
          <p className="text-xs text-slate-600">{medicine.doseText}</p>
          {medicine.frequencyText && (
            <p className="text-xs text-slate-500">{medicine.frequencyText}</p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            {medicine.memberName && <span>{medicine.memberName}</span>}
            {medicine.reminderTimes.length > 0 && (
              <span>
                ·{' '}
                {medicine.reminderTimes
                  .map((time) => friendlyTime(time, household.locale))
                  .join(', ')}
              </span>
            )}
            {medicine.reminderTimes.length === 0 && <span>· No reminders set</span>}
            {medicine.endDate && <span>· until {longDate(medicine.endDate, household.locale)}</span>}
          </div>

          {medicine.instructions && (
            <p className="mt-1 text-xs text-slate-500">{medicine.instructions}</p>
          )}

          {medicine.needsRefill && (
            <p className="mt-1.5">
              <Badge tone="warning" icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}>
                {medicine.quantityRemaining} left
              </Badge>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {medicine.quantityRemaining !== null && !medicine.needsRefill && (
            <span className="text-xs text-slate-500 tabular-nums">
              {medicine.quantityRemaining} left
            </span>
          )}
          <Button size="sm" variant="secondary" onClick={onRefill}>
            <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" />
            Refill
          </Button>
          <Button
            variant="ghost"
            iconOnly
            aria-label={`Delete "${medicine.name}"`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="h-4 w-4 text-slate-400" />
          </Button>
        </div>
      </div>

      {confirming && (
        <div className="mt-2 rounded-lg bg-slate-50 p-3">
          <p className="text-sm text-slate-700">Delete “{medicine.name}”?</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Doses already recorded stay in the history.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                remove.mutate(medicine.id, {
                  onSuccess: () => toast.success('Medicine deleted'),
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

function RefillSheet({
  medicine,
  onClose,
}: {
  medicine: MedicineView | null;
  onClose: () => void;
}) {
  const household = useHousehold();
  const toast = useToast();
  const refill = useRefillMedicine(household.id);
  const [quantity, setQuantity] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!medicine) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    if (!medicine) return;

    const quantityAdded = Number(quantity);
    if (!Number.isFinite(quantityAdded) || quantityAdded <= 0) {
      setErrors({ quantityAdded: 'How many were added?' });
      return;
    }

    try {
      await refill.mutateAsync({ medicineId: medicine.id, input: { quantityAdded } });
      toast.success('Refill recorded');
      setQuantity('');
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      toast.error(error instanceof ApiError ? error.message : 'Could not record that');
    }
  }

  return (
    <Sheet open onClose={onClose} title={`Refill ${medicine.name}`}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="How many were added?"
          error={errors.quantityAdded}
          hint={
            medicine.quantityRemaining === null
              ? 'Count them however you buy them — tablets, bottles, strips.'
              : `${medicine.quantityRemaining} on hand now`
          }
          required
        >
          {({ id, invalid }) => (
            <Input
              id={id}
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="30"
              invalid={invalid}
              required
            />
          )}
        </Field>

        <Button type="submit" size="lg" loading={refill.isPending} className="w-full">
          Record refill
        </Button>
      </form>
    </Sheet>
  );
}

/** Up to this many reminder time inputs; the schema caps the list at 12. */
const MAX_TIMES = 6;

function AddMedicineSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const household = useHousehold();
  const toast = useToast();
  const create = useCreateMedicine(household.id);
  const members = useMembers(household.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [times, setTimes] = useState<string[]>(['']);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = createMedicineSchema.safeParse({
      ...form,
      // Only the times actually filled in. An empty row means "not set", not
      // midnight.
      reminderTimes: times.filter((time) => time !== ''),
    });

    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }

    try {
      await create.mutateAsync(parsed.data);
      toast.success('Medicine added');
      setTimes(['']);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      toast.error(error instanceof ApiError ? error.message : 'Could not add that medicine');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add a medicine">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          Copy the dose and frequency from the prescription. We show them back word for word and
          never work out a dose for you.
        </div>

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

        <Field label="Medicine" error={errors.name} required>
          {({ id, invalid }) => (
            <Input id={id} name="name" placeholder="e.g. Amoxicillin 500mg" invalid={invalid} required />
          )}
        </Field>

        <Field
          label="Dose"
          error={errors.doseText}
          hint="Exactly as written — e.g. “1 tablet”, “5ml”, “half a tablet”"
          required
        >
          {({ id, invalid }) => (
            <Input id={id} name="doseText" placeholder="1 tablet" invalid={invalid} required />
          )}
        </Field>

        <Field
          label="How often"
          error={errors.frequencyText}
          hint="Optional, and in the prescription's own words"
        >
          {({ id }) => (
            <Input id={id} name="frequencyText" placeholder="twice daily, after food" />
          )}
        </Field>

        {/* Entered, never inferred from "how often" above. */}
        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-slate-700">
            Remind at these times
          </legend>
          <p className="mb-2 text-xs text-slate-500">
            Leave empty for no reminders. These are the times you choose, not times we work out.
          </p>
          <div className="space-y-2">
            {times.map((time, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  type="time"
                  aria-label={`Reminder time ${index + 1}`}
                  value={time}
                  onChange={(event) => {
                    const next = [...times];
                    next[index] = event.target.value;
                    setTimes(next);
                  }}
                />
                {times.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    iconOnly
                    aria-label={`Remove reminder time ${index + 1}`}
                    onClick={() => setTimes(times.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4 text-slate-400" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {times.length < MAX_TIMES && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setTimes([...times, ''])}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add another time
            </Button>
          )}
          {errors['reminderTimes'] && (
            <p className="mt-1 text-xs text-danger">{errors['reminderTimes']}</p>
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" error={errors.startDate} required>
            {({ id }) => (
              <Input
                id={id}
                name="startDate"
                type="date"
                defaultValue={todayIn(household.timezone)}
                required
              />
            )}
          </Field>
          <Field label="Ends" error={errors.endDate} hint="Optional">
            {({ id }) => <Input id={id} name="endDate" type="date" />}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="How many do you have?" error={errors.quantityRemaining} hint="Optional">
            {({ id }) => <Input id={id} name="quantityRemaining" inputMode="numeric" placeholder="30" />}
          </Field>
          <Field label="Warn me at" error={errors.refillThreshold} hint="Optional">
            {({ id }) => <Input id={id} name="refillThreshold" inputMode="numeric" placeholder="5" />}
          </Field>
        </div>

        <Field label="Prescribed by" error={errors.prescribedByDoctorName} hint="Optional">
          {({ id }) => <Input id={id} name="prescribedByDoctorName" placeholder="Dr Saleem" />}
        </Field>

        <Field label="Anything else to remember?" error={errors.instructions} hint="Optional">
          {({ id }) => (
            <Textarea id={id} name="instructions" rows={2} placeholder="Take with a full glass of water" />
          )}
        </Field>

        <Button type="submit" size="lg" loading={create.isPending} className="w-full">
          Add medicine
        </Button>
      </form>
    </Sheet>
  );
}
