import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Home } from 'lucide-react';
import { loginSchema, registerSchema } from '@hms/shared';
import { ApiError, api } from '../../lib/api.js';
import { useSession } from '../../app/session.js';
import { Button, Card, Field, Input } from '../../components/ui/index.js';
import { useToast } from '../../components/ui/toast.js';

function AuthShell({ title, subtitle, children, footer }: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col justify-center bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Home className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <Card className="p-6">{children}</Card>
        {footer && <div className="mt-4 text-center text-sm text-slate-600">{footer}</div>}
      </div>
    </div>
  );
}

/** Maps server field errors onto inputs, using the same paths the API returns. */
function useFormErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function handle(error: unknown): void {
    if (error instanceof ApiError) {
      setErrors(error.fieldErrors);
      setFormError(error.details?.length ? null : error.message);
      return;
    }
    setFormError('Something went wrong. Please try again.');
  }

  function clear(): void {
    setErrors({});
    setFormError(null);
  }

  return { errors, formError, handle, clear, setErrors };
}

export function LoginScreen() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const { errors, formError, handle, clear } = useFormErrors();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clear();

    const form = new FormData(event.currentTarget);
    // Validated with the same schema the server uses, so the rules cannot drift.
    const parsed = loginSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      handle(new ApiError('VALIDATION_ERROR', 'Check the form', 400,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/login', parsed.data);
      await refresh();
      navigate('/', { replace: true });
    } catch (error) {
      handle(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your household"
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-medium text-brand-700 underline">Create an account</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}

        <Field label="Email" error={errors.email} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              aria-describedby={describedBy}
              invalid={invalid}
              required
            />
          )}
        </Field>

        <Field label="Password" error={errors.password} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              name="password"
              type="password"
              autoComplete="current-password"
              aria-describedby={describedBy}
              invalid={invalid}
              required
            />
          )}
        </Field>

        <Button type="submit" size="lg" loading={busy} className="w-full">Sign in</Button>

        <p className="text-center text-sm">
          <Link to="/forgot-password" className="text-slate-600 underline">Forgotten your password?</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function RegisterScreen() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const { errors, formError, handle, clear } = useFormErrors();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clear();

    const form = new FormData(event.currentTarget);
    const parsed = registerSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      handle(new ApiError('VALIDATION_ERROR', 'Check the form', 400,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
      return;
    }

    setBusy(true);
    try {
      const result = await api.post<{ user: unknown | null; created: boolean }>(
        '/auth/register',
        parsed.data,
      );
      if (!result?.created) {
        // The server will not confirm whether an address exists; it emails the
        // owner instead. Say so honestly rather than inventing an error.
        handle(new ApiError('CONFLICT',
          'If that address can be used, we have sent it an email. Try signing in instead.', 409));
        return;
      }
      await refresh();
      navigate('/setup', { replace: true });
    } catch (error) {
      handle(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Set up your household"
      subtitle="One place for everything your family needs to keep track of"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-700 underline">Sign in</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}

        <Field label="Your name" error={errors.displayName} required>
          {({ id, describedBy, invalid }) => (
            <Input id={id} name="displayName" autoComplete="name" aria-describedby={describedBy} invalid={invalid} required />
          )}
        </Field>

        <Field label="Email" error={errors.email} required>
          {({ id, describedBy, invalid }) => (
            <Input id={id} name="email" type="email" autoComplete="email" inputMode="email" aria-describedby={describedBy} invalid={invalid} required />
          )}
        </Field>

        <Field
          label="Password"
          error={errors.password}
          hint="At least 10 characters. Length matters more than symbols."
          required
        >
          {({ id, describedBy, invalid }) => (
            <Input id={id} name="password" type="password" autoComplete="new-password" aria-describedby={describedBy} invalid={invalid} required />
          )}
        </Field>

        <Button type="submit" size="lg" loading={busy} className="w-full">Create account</Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordScreen() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    setBusy(true);
    try {
      await api.post('/auth/password/forgot', { email });
    } finally {
      // The response is identical whether or not the address exists, so the
      // screen must be too.
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We’ll email you a link"
      footer={<Link to="/login" className="text-slate-600 underline">Back to sign in</Link>}
    >
      {sent ? (
        <p className="text-sm text-slate-700">
          If that address has an account, a reset link is on its way. The link is valid for one hour.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" required>
            {({ id, describedBy }) => (
              <Input id={id} name="email" type="email" autoComplete="email" inputMode="email" aria-describedby={describedBy} required />
            )}
          </Field>
          <Button type="submit" size="lg" loading={busy} className="w-full">Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { errors, formError, handle, clear } = useFormErrors();
  const [busy, setBusy] = useState(false);
  const token = params.get('token') ?? '';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clear();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');

    setBusy(true);
    try {
      await api.post('/auth/password/reset', { token, password });
      toast.success('Password changed — please sign in');
      navigate('/login', { replace: true });
    } catch (error) {
      handle(error);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthShell title="Reset your password" subtitle="That link is incomplete">
        <p className="text-sm text-slate-700">
          The reset link is missing its token. Request a new one from the sign-in page.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="You’ll be signed out everywhere else">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{formError}</p>
        )}
        <Field label="New password" error={errors.password} hint="At least 10 characters." required>
          {({ id, describedBy, invalid }) => (
            <Input id={id} name="password" type="password" autoComplete="new-password" aria-describedby={describedBy} invalid={invalid} required />
          )}
        </Field>
        <Button type="submit" size="lg" loading={busy} className="w-full">Change password</Button>
      </form>
    </AuthShell>
  );
}
