import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell.js';
import { useSession } from './session.js';
import { Spinner } from '../components/ui/index.js';
import {
  ForgotPasswordScreen,
  LoginScreen,
  RegisterScreen,
  ResetPasswordScreen,
} from '../features/auth/AuthScreens.js';
import { SetupScreen } from '../features/auth/SetupScreen.js';
import { DashboardScreen } from '../features/dashboard/DashboardScreen.js';
import { TasksScreen } from '../features/tasks/TasksScreen.js';
import { CalendarScreen } from '../features/calendar/CalendarScreen.js';
import { RemindersScreen } from '../features/calendar/RemindersScreen.js';
import { FamilyScreen } from '../features/family/FamilyScreen.js';
import { HomeHubScreen, MoneyHubScreen } from '../features/hubs/HubScreens.js';
import { ShoppingScreen } from '../features/shopping/ShoppingScreen.js';
import { ShoppingListScreen } from '../features/shopping/ShoppingListScreen.js';
import { ExpensesScreen } from '../features/money/ExpensesScreen.js';
import { BillsScreen } from '../features/money/BillsScreen.js';
import { BudgetsScreen } from '../features/money/BudgetsScreen.js';

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading">
      <Spinner className="h-8 w-8 text-brand-600" />
    </div>
  );
}

/** Signed-in users only; anyone else goes to sign-in. */
function RequireAuth() {
  const { status } = useSession();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <Outlet />;
}

/**
 * Signed in *and* in a household. A user with no household is sent to setup
 * rather than shown an app shell with nothing in it.
 */
function RequireHousehold() {
  const { status, households } = useSession();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  if (households.length === 0) return <Navigate to="/setup" replace />;
  return <AppShell />;
}

/** Signed-in users should not see the sign-in screen. */
function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <RedirectIfAuthenticated><LoginScreen /></RedirectIfAuthenticated> },
  { path: '/register', element: <RedirectIfAuthenticated><RegisterScreen /></RedirectIfAuthenticated> },
  { path: '/forgot-password', element: <ForgotPasswordScreen /> },
  { path: '/reset-password', element: <ResetPasswordScreen /> },

  {
    element: <RequireAuth />,
    children: [{ path: '/setup', element: <SetupScreen /> }],
  },

  {
    element: <RequireHousehold />,
    children: [
      { path: '/', element: <DashboardScreen /> },
      { path: '/calendar', element: <CalendarScreen /> },
      { path: '/calendar/reminders', element: <RemindersScreen /> },
      { path: '/home', element: <HomeHubScreen /> },
      { path: '/home/tasks', element: <TasksScreen /> },
      { path: '/home/shopping', element: <ShoppingScreen /> },
      { path: '/home/shopping/:listId', element: <ShoppingListScreen /> },
      { path: '/money', element: <MoneyHubScreen /> },
      { path: '/money/expenses', element: <ExpensesScreen /> },
      { path: '/money/bills', element: <BillsScreen /> },
      { path: '/money/budgets', element: <BudgetsScreen /> },
      { path: '/family', element: <FamilyScreen /> },
    ],
  },

  { path: '*', element: <Navigate to="/" replace /> },
]);
