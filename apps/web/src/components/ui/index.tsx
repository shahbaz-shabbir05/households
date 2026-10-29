/**
 * The UI primitives.
 *
 * Hand-built rather than pulled from a kit: the surface here is small (lists,
 * forms, sheets), and a kit's theming layer costs more on mobile than it saves
 * — and makes accessibility *look* solved without being solved (docs/11).
 */

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { X } from 'lucide-react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'bg-danger text-white hover:opacity-90',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Renders icon-only; `aria-label` becomes mandatory in review. */
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, iconOnly, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_VARIANTS[variant],
        iconOnly ? 'h-11 w-11 p-0' : BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------- Field */

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/**
 * Every input gets a real `<label>` — never a placeholder standing in for one,
 * which disappears the moment someone starts typing.
 */
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500">{hint}</p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-danger">{error}</p>
      )}
    </div>
  );
}

const CONTROL_CLASSES =
  'block w-full rounded-lg border-0 bg-white px-3 py-2.5 text-base text-slate-900 ' +
  'ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 ' +
  'focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cx(CONTROL_CLASSES, invalid && 'ring-danger focus:ring-danger', className)}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} rows={3} className={cx(CONTROL_CLASSES, className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx(CONTROL_CLASSES, 'pr-8', className)} {...rest}>
        {children}
      </select>
    );
  },
);

/* -------------------------------------------------------------------- Card */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-xl bg-white shadow-sm ring-1 ring-slate-200', className)}>
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <h2 className="text-sm font-semibold tracking-wide text-slate-600 uppercase">
        {title}
        {count !== undefined && count > 0 && (
          <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
            {count}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}

/* --------------------------------------------------------- Mandatory states */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden="true" />;
}

/** Skeletons shaped like the content they replace, so nothing shifts on load. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <Card key={index} className="p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </Card>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * Empty states are the onboarding. "No bills yet" is wrong; telling the user
 * what they get by adding one is right (docs/11).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="px-6 py-10 text-center">
      {icon && <div className="mx-auto mb-3 text-slate-300">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="px-6 py-8 text-center">
      <h3 className="text-base font-semibold text-slate-800">That didn’t load</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      {onRetry && (
        <div className="mt-5 flex justify-center">
          <Button variant="secondary" onClick={onRetry}>Try again</Button>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- Sheet */

/**
 * A bottom sheet on mobile, a centred dialog on larger screens. Creation flows
 * use this rather than a centred modal, because the bottom of the screen is
 * where a thumb can reach.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Call sites pass an inline arrow, so `onClose` has a new identity on every
  // parent render. Depending on it directly re-ran this effect each time —
  // tearing down focus and re-focusing the first input, which yanked the caret
  // out of whatever the user was typing. The ref keeps the handler current
  // without making it a dependency.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Focus the first *field*, not merely the first focusable element:
    // `querySelector` returns document order, so a toolbar button above the form
    // would otherwise steal focus and cost the user a tab press on every open.
    const firstField = panel?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select');
    (firstField ?? panel?.querySelector<HTMLElement>('button:not([disabled])'))?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      // Focus stays inside the dialog while it is open.
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      // Focus goes back where it came from, not to the top of the page.
      previouslyFocused.current?.focus();
    };
    // Deliberately only `open`: see the note on onCloseRef above.
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl',
          'sm:max-w-lg sm:rounded-2xl',
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <Button variant="ghost" iconOnly onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div
            className="border-t border-slate-200 px-4 py-3"
            style={{ paddingBottom: 'calc(0.75rem + var(--spacing-safe-bottom))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-100 text-brand-900',
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-[color:var(--color-warning)]',
  success: 'bg-success-bg text-success',
} as const;

export function Badge({
  tone = 'neutral',
  children,
  icon,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
      )}
    >
      {/* Colour is never the only signal — badges carry an icon or a word too. */}
      {icon}
      {children}
    </span>
  );
}
