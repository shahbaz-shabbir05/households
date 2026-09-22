import type { CreateMemberInput, HouseholdRole, Relationship, UpdateMemberInput } from '@hms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../lib/api.js';
import { qk } from '../../lib/query-keys.js';

export interface MemberView {
  id: string;
  displayName: string;
  role: HouseholdRole;
  relationship: Relationship;
  dateOfBirth: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  avatarAttachmentId: string | null;
  isActive: boolean;
  hasLogin: boolean;
  isSelf: boolean;
}

const base = (householdId: string) => `/households/${householdId}/members`;

export function useMembers(householdId: string, includeInactive = false) {
  return useQuery({
    queryKey: [...qk.members(householdId), { includeInactive }],
    queryFn: () => api.get<MemberView[]>(`${base(householdId)}${qs({ includeInactive })}`),
    // Members change rarely and are referenced by almost every screen.
    staleTime: 5 * 60_000,
  });
}

export function useCreateMember(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMemberInput) => api.post<MemberView>(base(householdId), input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.members(householdId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
    },
  });
}

export function useUpdateMember(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, input }: { memberId: string; input: UpdateMemberInput }) =>
      api.patch<MemberView>(`${base(householdId)}/${memberId}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.members(householdId) }),
  });
}

export function useDeactivateMember(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => api.delete(`${base(householdId)}/${memberId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.members(householdId) }),
  });
}

export function useInviteMember(householdId: string) {
  return useMutation({
    mutationFn: ({ memberId, email }: { memberId: string; email: string }) =>
      api.post(`/households/${householdId}/invites`, { memberId, email }),
  });
}
