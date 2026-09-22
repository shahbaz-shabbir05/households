/**
 * The application shell.
 *
 * Bottom tabs on a phone, a sidebar on a desktop — same routes, same
 * components, only the chrome differs. Five destinations, because a mobile tab
 * bar tolerates about five and a hamburger menu is where features go to be
 * forgotten (docs/03).
 */

import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  CalendarDays,
  ChevronDown,
  Home as HomeIcon,
  LogOut,
  Plus,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import { useSession } from './session.js';
import { allows, type UiCapability } from './permissions.js';
import { Button, cx } from '../components/ui/index.js';
import { QuickAddSheet } from '../features/quick-add/QuickAddSheet.js';

interface Destination {
  to: string;
  label: string;
  icon: typeof HomeIcon;
  /** Omitted means everyone sees it. */
  capability?: UiCapability;
}

const DESTINATIONS: Destination[] = [
  { to: '/', label: 'Today', icon: HomeIcon },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/home', label: 'Home', icon: Wrench },
  { to: '/money', label: 'Money', icon: Wallet, capability: 'viewMoney' },
  { to: '/family', label: 'Family', icon: Users },
];

export function AppShell() {
  const { household, households, selectHousehold, user, signOut } = useSession();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const location = useLocation();

  // Nav is filtered by the same rules the server enforces. Hiding is UX; the
  // server check is the control.
  const destinations = DESTINATIONS.filter(
    (d) => !d.capability || (household && allows(household.role, d.capability)),
  );

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Skip link: the first stop for anyone navigating by keyboard. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      <div className="lg:flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white">
          <div className="border-b border-slate-200 p-4">
            <HouseholdSwitcher
              households={households}
              activeId={household?.id ?? null}
              onSelect={selectHousehold}
            />
          </div>
          <nav aria-label="Main" className="flex-1 space-y-1 p-3">
            {destinations.map((destination) => (
              <SidebarLink key={destination.to} destination={destination} />
            ))}
          </nav>
          <div className="border-t border-slate-200 p-3">
            <p className="truncate px-3 pb-2 text-xs text-slate-500">{user?.displayName}</p>
            <button
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile header */}
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <HouseholdSwitcher
                households={households}
                activeId={household?.id ?? null}
                onSelect={selectHousehold}
              />
              <Button variant="ghost" iconOnly onClick={() => void signOut()} aria-label="Sign out">
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </header>

          <main id="main" className="flex-1 px-4 pb-28 pt-4 lg:px-8 lg:pb-12">
            <div className="mx-auto w-full max-w-3xl lg:max-w-5xl">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      {/*
        All five destinations get a tab. An earlier version put the quick-add
        button in the centre of the bar, which only works with an even number of
        tabs — it silently pushed "Family" off the bar entirely. The button now
        floats above the bar instead, still within thumb reach.
      */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white lg:hidden"
        style={{ paddingBottom: 'var(--spacing-safe-bottom)' }}
      >
        <ul className="flex items-stretch">
          {destinations.map((destination) => (
            <TabLink key={destination.to} destination={destination} pathname={location.pathname} />
          ))}
        </ul>
      </nav>

      <button
        onClick={() => setQuickAddOpen(true)}
        aria-label="Add something"
        className="fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition-colors hover:bg-brand-700 lg:hidden"
        style={{ bottom: 'calc(5.5rem + var(--spacing-safe-bottom))' }}
      >
        <Plus className="h-7 w-7" aria-hidden="true" />
      </button>

      {/* Desktop quick-add */}
      <button
        onClick={() => setQuickAddOpen(true)}
        aria-label="Add something"
        className="fixed bottom-8 right-8 z-40 hidden h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700 lg:flex"
      >
        <Plus className="h-7 w-7" aria-hidden="true" />
      </button>

      <QuickAddSheet open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
    </div>
  );
}

function SidebarLink({ destination }: { destination: Destination }) {
  const Icon = destination.icon;
  return (
    <NavLink
      to={destination.to}
      end={destination.to === '/'}
      className={({ isActive }) =>
        cx(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-brand-50 text-brand-900' : 'text-slate-700 hover:bg-slate-100',
        )
      }
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      {destination.label}
    </NavLink>
  );
}

function TabLink({ destination, pathname }: { destination: Destination; pathname: string }) {
  const Icon = destination.icon;
  const isActive = destination.to === '/' ? pathname === '/' : pathname.startsWith(destination.to);

  return (
    <li className="flex-1">
      <NavLink
        to={destination.to}
        end={destination.to === '/'}
        aria-current={isActive ? 'page' : undefined}
        className={cx(
          'flex touch-target flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
          isActive ? 'text-brand-700' : 'text-slate-500',
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
        {destination.label}
      </NavLink>
    </li>
  );
}

function HouseholdSwitcher({
  households,
  activeId,
  onSelect,
}: {
  households: Array<{ id: string; name: string }>;
  activeId: string | null;
  onSelect(id: string): void;
}) {
  const active = households.find((h) => h.id === activeId);

  // With one household there is nothing to switch between — show a heading.
  if (households.length <= 1) {
    return <p className="truncate text-base font-semibold text-slate-900">{active?.name ?? 'Household'}</p>;
  }

  return (
    <div className="relative">
      <label htmlFor="household-switcher" className="sr-only">Switch household</label>
      <select
        id="household-switcher"
        value={activeId ?? ''}
        onChange={(event) => onSelect(event.target.value)}
        className="w-full appearance-none rounded-lg bg-transparent py-1 pr-7 text-base font-semibold text-slate-900 focus:outline-none"
      >
        {households.map((household) => (
          <option key={household.id} value={household.id}>{household.name}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 top-2 h-4 w-4 text-slate-400" aria-hidden="true" />
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-slate-900 lg:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
