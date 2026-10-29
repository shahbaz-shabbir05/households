import { useQuery } from '@tanstack/react-query';
import type { EntityType, Priority } from '@hms/shared';
import { api } from '../../lib/api.js';
import { qk } from '../../lib/query-keys.js';

export interface DashboardItem {
  id: string;
  entityType: EntityType;
  title: string;
  subtitle: string | null;
  date: string;
  time: string | null;
  priority: Priority;
  isOverdue: boolean;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  amountMinor: number | null;
  quickAction: string | null;
}

export interface DashboardSummary {
  generatedAt: string;
  window: { today: string; weekFrom: string; weekTo: string };
  needsAttention: DashboardItem[];
  today: DashboardItem[];
  thisWeek: DashboardItem[];
  counts: { needsAttention: number; today: number; thisWeek: number; unreadNotifications: number };
  household: { id: string; name: string; currency: string; timezone: string; memberCount: number };
  quickActions: string[];
}

export function useDashboard(householdId: string) {
  return useQuery({
    queryKey: qk.dashboard(householdId),
    queryFn: () => api.get<DashboardSummary>(`/households/${householdId}/dashboard`),
    // The answer to "what needs attention now" should not be stale for long.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
