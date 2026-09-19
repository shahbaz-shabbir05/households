# 09 — Notification Architecture

§24 asks for a system not coupled to any provider. The design separates four
concerns that are usually tangled together:

```
 1. EVENT SOURCE          2. RULES                3. NOTIFICATION      4. CHANNEL
 (something is true)      (should we tell?)       (the message)        (how it leaves)

 reminder due ─┐                                                      ┌─ in-app (MVP)
 bill overdue ─┤                                ┌───────────────┐     ├─ email (V1)
 stock low   ──┼──►  NotificationRules  ──────► │ notifications │ ──► ├─ web push (V2)
 doc expiring ─┤     · who should know?         │  (+ deliveries)│     ├─ SMS (Future)
 dose due    ──┤     · quiet hours?             └───────────────┘     └─ WhatsApp (Future)
 appointment ──┘     · already told them?
```

## Why the split matters

The common mistake is calling `sendEmail()` from inside the bills service. Then
every module owns delivery logic, quiet hours are implemented five times, and
adding push means touching every module. Here, a module's only job is to say
*"this became true"*; everything after that is platform.

```ts
// what a module does — and all it does
await notifications.publish(ctx, {
  type: 'bill.due_soon',
  subjectMemberIds: [bill.ownerMemberId ?? ...adultsOf(household)],
  entity: { type: 'bill', id: bill.id },
  title: 'Electricity bill due in 3 days',
  body: 'K-Electric · PKR 18,400 · due 21 Sep',
  priority: 'normal',
  dedupeKey: `bill:${bill.id}:due_soon`,
});
```

## Channel abstraction

```ts
interface NotificationChannel {
  readonly name: 'inapp' | 'email' | 'push' | 'sms' | 'whatsapp';
  isAvailableFor(member, prefs): boolean;
  deliver(notification, recipient): Promise<DeliveryResult>;
}
```

Channels register in a `ChannelRegistry`. MVP ships `InAppChannel` and a
`ConsoleEmailChannel` (logs, used in dev/tests). Adding a real provider is a new
file plus a config entry — no module changes, no schema changes.

`notification_deliveries` records one row **per channel per notification** with
status/attempts/error, so "did Bilal actually get told?" is answerable. Retries
use exponential backoff with a cap; permanent failures are recorded, not
retried forever.

## The three rules that stop it becoming spam

This is the part that determines whether users keep the app installed.

1. **Deduplication.** `dedupe_key` + a partial unique index. A bill that is
   overdue for six days produces *one* "overdue" notification that updates, not
   six. The daily scan is idempotent by construction.
2. **Quiet hours.** Per household (default 22:00–07:00 local). Non-urgent
   notifications generated in quiet hours are queued to the next window start.
   `priority: 'urgent'` bypasses. Medicine doses are exempt from *deferral*
   because a 22:00 dose reminder at 07:00 is worse than useless — instead they
   are simply never *escalated* to other channels at night.
3. **Coalescing.** The morning digest groups everything due today into one
   notification ("4 things need attention today") rather than four. Per-item
   notifications are reserved for time-specific things (a dose at 20:00, an
   appointment in 1 hour).

## Preferences

Per member × per notification type × per channel, stored as a JSONB blob on the
member with a typed default. A sparse override map keeps it simple:

```jsonc
{ "bill.due_soon": { "email": false }, "task.assigned": { "inapp": true } }
```

Defaults are chosen per type (e.g. `bill.overdue` defaults on for admins/adults,
off for teens). Unset = default.

## Reminders vs notifications

These are distinct and often confused:

- A **reminder** is a *user-created intention*: "tell me about X at time T".
  It is data. It appears in the UI, can be edited, snoozed, assigned, recurring.
- A **notification** is a *system-generated message*: the delivery of any
  noteworthy fact, of which a firing reminder is one source among many.

`dispatchReminders` (every minute) is the bridge: due reminders → `publish()` →
notifications → channels. Snooze sets a new `remind_at`; dismiss sets status.
