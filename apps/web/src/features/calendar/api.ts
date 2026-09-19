import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateEventInput, CreateReminderInput, EventType, Priority, ReminderStatus } from '@hms/shared';
import { api, qs } from '../../lib/api.js';
import { qk } from '../../lib/query-keys.js';

export interface EventView {
  id: string;
  title: string;
  description: string | null;
  eventType: EventType;
  startDate: string;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  isAllDay: boolean;
  location: string | null;
  participantMemberIds: string[];
  isRecurring: boolean;
  seriesId: string | null;
  createdAt: string;
}

export interface ReminderView {
  id: string;
  title: string;
  body: string | null;
  remindOnDate: string;
  remindAtTime: string;
  remindAt: string;
  priority: Priority;
  status: ReminderStatus;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  entityType: string | null;
  entityId: string | null;
  isRecurring: boolean;
  createdAt: string;
}

export function useEvents(householdId: string, range: { from: string; to: string }) {
  return useQuery({
    queryKey: qk.eventList(householdId, range),
    queryFn: () =>
      api.getList<EventView>(`/households/${householdId}/events${qs({ ...range, perPage: 100 })}`),
    placeholderData: (previous) => previous,
  });
}

export function useCreateEvent(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) =>
      api.post<EventView>(`/households/${householdId}/events`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.events(householdId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
    },
  });
}

export function useReminders(householdId: string, filters: Record<string, string | number> = {}) {
  return useQuery({
    queryKey: qk.reminderList(householdId, filters),
    queryFn: () =>
      api.getList<ReminderView>(`/households/${householdId}/reminders${qs({ ...filters, perPage: 100 })}`),
  });
}

export function useCreateReminder(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReminderInput) =>
      api.post<ReminderView>(`/households/${householdId}/reminders`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.reminders(householdId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
    },
  });
}

export function useDismissReminder(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reminderId: string) =>
      api.post(`/households/${householdId}/reminders/${reminderId}/dismiss`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.reminders(householdId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
    },
  });
}

export function useSnoozeReminder(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reminderId, minutes }: { reminderId: string; minutes: number }) =>
      api.post(`/households/${householdId}/reminders/${reminderId}/snooze`, { minutes }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.reminders(householdId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
    },
  });
}
