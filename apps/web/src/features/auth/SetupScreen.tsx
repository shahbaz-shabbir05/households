/**
 * First run.
 *
 * Target: a usable household in under three minutes (docs/02 §J1). Name and
 * country only — currency and timezone are derived and editable later, and
 * email verification does not block anything here.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react';
import { createHouseholdSchema } from '@hms/shared';
import { api, ApiError } from '../../lib/api.js';
import { useSession } from '../../app/session.js';
import { Button, Card, Field, Input, Select } from '../../components/ui/index.js';

/**
 * A small starter list. Pakistan leads because that is the first market, but
 * nothing about the architecture assumes it — the list is data, not a branch
 * in the code (brief §33).
 */
const COUNTRIES = [
  { code: 'PK', name: 'Pakistan', currency: 'PKR', timezone: 'Asia/Karachi', locale: 'en-PK' },
  { code: 'IN', name: 'India', currency: 'INR', timezone: 'Asia/Kolkata', locale: 'en-IN' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', timezone: 'Europe/London', locale: 'en-GB' },
  { code: 'US', name: 'United States', currency: 'USD', timezone: 'America/New_York', locale: 'en-US' },
  { code: 'CA', name: 'Canada', currency: 'CAD', timezone: 'America/Toronto', locale: 'en-CA' },
  { code: 'AU', name: 'Australia', currency: 'AUD', timezone: 'Australia/Sydney', locale: 'en-AU' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', timezone: 'Asia/Riyadh', locale: 'en-SA' },
];

export function SetupScreen() {
  const { refresh, selectHousehold } = useSession();
  const navigate = useNavigate();
  const [countryCode, setCountryCode] = useState('PK');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const country = COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0]!;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const name = String(new FormData(event.currentTarget).get('name') ?? '');
    const parsed = createHouseholdSchema.safeParse({
      name,
      currency: country.currency,
      timezone: country.timezone,
      countryCode: country.code,
      locale: country.locale,
    });

    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }

    setBusy(true);
    try {
      const household = await api.post<{ id: string }>('/households', parsed.data);
      await refresh();
      if (household) selectHousehold(household.id);
      navigate('/family', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Home className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Name your household</h1>
          <p className="mt-1 text-sm text-slate-500">
            You can add everyone else in a moment. This takes about a minute.
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Household name" error={errors.name} required>
              {({ id, invalid }) => (
                <Input id={id} name="name" placeholder="e.g. The Khan household" invalid={invalid} required autoFocus />
              )}
            </Field>

            <Field
              label="Country"
              error={errors.countryCode}
              hint={`Currency ${country.currency} · time zone ${country.timezone}. Both can be changed later.`}
            >
              {({ id }) => (
                <Select id={id} value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
                  {COUNTRIES.map((option) => (
                    <option key={option.code} value={option.code}>{option.name}</option>
                  ))}
                </Select>
              )}
            </Field>

            <Button type="submit" size="lg" loading={busy} className="w-full">Create household</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
