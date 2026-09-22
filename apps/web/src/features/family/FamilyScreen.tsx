/**
 * Family members.
 *
 * The important thing this screen communicates: a member does not need a login.
 * Children and helpers are tracked and assignable without an account, and can
 * be given one later without losing any history (docs/04).
 */

import { useState, type FormEvent } from 'react';
import { Mail, ShieldCheck, UserPlus, Users } from 'lucide-react';
import type { HouseholdRole } from '@hms/shared';
import { createMemberSchema } from '@hms/shared';
import { useHousehold } from '../../app/session.js';
import { allows } from '../../app/permissions.js';
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
} from '../../components/ui/index.js';
import { useToast } from '../../components/ui/toast.js';
import { ApiError } from '../../lib/api.js';
import { useCreateMember, useInviteMember, useMembers, type MemberView } from './api.js';

const ROLE_LABELS: Record<HouseholdRole, string> = {
  admin: 'Admin',
  adult: 'Adult',
  teen: 'Teen',
  child: 'Child',
  helper: 'Helper',
};

const ROLE_HINTS: Record<HouseholdRole, string> = {
  admin: 'Can manage everything, including members and roles',
  adult: 'Can manage household data, money and health records',
  teen: 'Own tasks and the shared calendar. No money or documents',
  child: 'Own tasks and the shared calendar only',
  helper: 'Only the tasks assigned to them',
};

export function FamilyScreen() {
  const household = useHousehold();
  const query = useMembers(household.id);
  const [addOpen, setAddOpen] = useState(false);
  const canManage = allows(household.role, 'manageMembers');

  return (
    <div>
      <PageHeader
        title="Family"
        subtitle="Everyone in this household"
        action={
          canManage ? (
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
          ) : undefined
        }
      />

      {query.isPending ? (
        <ListSkeleton rows={4} />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'We could not load your household.'}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="Nobody added yet"
          description="Add everyone who lives here. They don’t need an account — you can assign tasks to a child or a helper straight away."
          action={canManage ? <Button onClick={() => setAddOpen(true)}>Add someone</Button> : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {query.data.map((member) => (
            <li key={member.id}>
              <MemberCard member={member} canManage={canManage} />
            </li>
          ))}
        </ul>
      )}

      <AddMemberSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function MemberCard({ member, canManage }: { member: MemberView; canManage: boolean }) {
  const household = useHousehold();
  const toast = useToast();
  const invite = useInviteMember(household.id);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState(member.email ?? '');

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    try {
      await invite.mutateAsync({ memberId: member.id, email });
      toast.success(`Invitation sent to ${email}`);
      setInviting(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not send that invitation');
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-900"
        >
          {initials(member.displayName)}
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <span className="truncate">{member.displayName}</span>
            {member.isSelf && <span className="text-xs font-normal text-slate-400">(you)</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge
              tone={member.role === 'admin' ? 'brand' : 'neutral'}
              icon={member.role === 'admin' ? <ShieldCheck className="h-3 w-3" aria-hidden="true" /> : undefined}
            >
              {ROLE_LABELS[member.role]}
            </Badge>
            {/* Stated plainly, because "can this person sign in?" is the
                question people actually ask on this screen. */}
            <Badge tone={member.hasLogin ? 'success' : 'neutral'}>
              {member.hasLogin ? 'Can sign in' : 'No login'}
            </Badge>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">{ROLE_HINTS[member.role]}</p>
        </div>

        {canManage && !member.hasLogin && !inviting && (
          <Button size="sm" variant="secondary" onClick={() => setInviting(true)}>
            <Mail className="h-4 w-4" aria-hidden="true" />
            Invite
          </Button>
        )}
      </div>

      {inviting && (
        <form onSubmit={onInvite} className="mt-3 rounded-lg bg-slate-50 p-3">
          <Field
            label={`Invite ${member.displayName} to sign in`}
            hint="Their tasks, events and history stay attached to this person."
          >
            {({ id }) => (
              <Input
                id={id}
                type="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="their@email.com"
                required
              />
            )}
          </Field>
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" loading={invite.isPending}>Send invitation</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setInviting(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function AddMemberSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const household = useHousehold();
  const toast = useToast();
  const createMember = useCreateMember(household.id);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = createMemberSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])),
      );
      return;
    }

    try {
      await createMember.mutateAsync(parsed.data);
      toast.success(`${parsed.data.displayName} added`);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      else toast.error('Could not add that person');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add someone to the household">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900">
          They don’t need an account. Add them now, assign them things, and send a login later
          if they want one.
        </p>

        <Field label="Name" error={errors.displayName} required>
          {({ id, invalid }) => <Input id={id} name="displayName" invalid={invalid} required />}
        </Field>

        <Field label="Role" error={errors.role} hint={undefined}>
          {({ id }) => (
            <Select id={id} name="role" defaultValue="adult">
              {(Object.keys(ROLE_LABELS) as HouseholdRole[]).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]} — {ROLE_HINTS[role]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Relationship" error={errors.relationship}>
          {({ id }) => (
            <Select id={id} name="relationship" defaultValue="other">
              {['spouse', 'parent', 'child', 'sibling', 'grandparent', 'relative', 'helper', 'other'].map((value) => (
                <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Date of birth" error={errors.dateOfBirth} hint="Optional — used for birthday reminders">
          {({ id }) => <Input id={id} name="dateOfBirth" type="date" />}
        </Field>

        <Button type="submit" size="lg" loading={createMember.isPending} className="w-full">
          Add to household
        </Button>
      </form>
    </Sheet>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
