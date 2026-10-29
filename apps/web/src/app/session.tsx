/**
 * Session and household context.
 *
 * The active household lives here rather than in every URL, so links stay short
 * and shareable within a household; the API, by contrast, is explicitly
 * household-scoped so the server never relies on implicit context (docs/03).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { HouseholdRole } from '@hms/shared';
import { api, setUnauthenticatedHandler } from '../lib/api.js';
import { qk } from '../lib/query-keys.js';

export interface HouseholdSummary {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  countryCode: string;
  locale: string;
  weekStartsOn: 0 | 1;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  role: HouseholdRole;
  memberId: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  emailVerified: boolean;
}

interface MeResponse {
  user: CurrentUser | null;
  households: HouseholdSummary[];
}

interface SessionValue {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: CurrentUser | null;
  households: HouseholdSummary[];
  household: HouseholdSummary | null;
  selectHousehold(id: string): void;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);
const ACTIVE_HOUSEHOLD_KEY = 'hms.activeHouseholdId';

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
    } catch {
      // Private browsing, or storage disabled — a remembered choice is a
      // convenience, never a requirement.
      return null;
    }
  });

  const query = useQuery({
    queryKey: qk.me(),
    queryFn: () => api.get<MeResponse>('/me'),
    retry: false,
    staleTime: 60_000,
  });

  // A 401 anywhere invalidates the session once, centrally.
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      queryClient.setQueryData(qk.me(), { user: null, households: [] });
    });
  }, [queryClient]);

  const households = query.data?.households ?? [];
  const household =
    households.find((h) => h.id === activeId) ?? households[0] ?? null;

  const selectHousehold = useCallback((id: string) => {
    setActiveId(id);
    try {
      localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: qk.me() });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');
    try {
      localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
    } catch {
      /* ignore */
    }
    // Everything cached belonged to the signed-out user.
    queryClient.clear();
    setActiveId(null);
    await queryClient.invalidateQueries({ queryKey: qk.me() });
  }, [queryClient]);

  const value = useMemo<SessionValue>(
    () => ({
      status: query.isPending ? 'loading' : query.data?.user ? 'authenticated' : 'anonymous',
      user: query.data?.user ?? null,
      households,
      household,
      selectHousehold,
      refresh,
      signOut,
    }),
    [query.isPending, query.data, households, household, selectHousehold, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}

/** The active household, for screens that are already behind the auth guard. */
export function useHousehold(): HouseholdSummary {
  const { household } = useSession();
  if (!household) throw new Error('No active household — this screen is behind RequireHousehold');
  return household;
}
