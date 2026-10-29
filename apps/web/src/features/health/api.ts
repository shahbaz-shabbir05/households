import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppointmentStatus,
  CreateAppointmentInput,
  CreateDoctorInput,
  CreateMedicineInput,
  DoseStatus,
  ListMeta,
  RecordDoseInput,
  RefillMedicineInput,
  UpdateAppointmentInput,
  UpdateMedicineInput,
} from '@hms/shared';
import { api, qs } from '../../lib/api.js';
import { qk } from '../../lib/query-keys.js';

export interface MedicineView {
  id: string;
  memberId: string;
  memberName: string | null;
  name: string;
  /** Shown exactly as it was typed. The UI never reformats this. */
  doseText: string;
  frequencyText: string | null;
  instructions: string | null;
  reminderTimes: string[];
  startDate: string;
  endDate: string | null;
  quantityRemaining: number | null;
  refillThreshold: number | null;
  prescribedByDoctorId: string | null;
  prescribedByName: string | null;
  isActive: boolean;
  needsRefill: boolean;
  notes: string | null;
}

export interface DoseView {
  id: string;
  medicineId: string;
  medicineName: string;
  doseText: string;
  memberId: string;
  memberName: string | null;
  scheduledOn: string;
  scheduledAtTime: string;
  status: DoseStatus;
  recordedAt: string | null;
}

export interface AppointmentView {
  id: string;
  memberId: string;
  memberName: string | null;
  doctorId: string | null;
  doctorName: string | null;
  scheduledOn: string;
  scheduledAtTime: string | null;
  location: string | null;
  reason: string | null;
  status: AppointmentStatus;
  outcomeNotes: string | null;
  followUpOn: string | null;
  remindDaysBefore: number;
  isRecurring: boolean;
  notes: string | null;
}

export interface DoctorView {
  id: string;
  name: string;
  specialty: string | null;
  clinic: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
}

const base = (h: string) => `/households/${h}`;

/**
 * Recording a dose moves the dose list, the medicine's remaining count and the
 * dashboard at once, so they are invalidated together.
 */
function useHealthInvalidation(householdId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.health(householdId) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
  };
}

/* ------------------------------------------------------------------- doses */

export function useDoses(householdId: string, filters: Record<string, string | undefined>) {
  return useQuery({
    queryKey: [...qk.health(householdId), 'doses', filters],
    queryFn: () => api.get<DoseView[]>(`${base(householdId)}/doses${qs(filters)}`),
    placeholderData: (previous) => previous,
  });
}

export function useRecordDose(householdId: string) {
  const invalidate = useHealthInvalidation(householdId);
  return useMutation({
    mutationFn: ({ doseId, input }: { doseId: string; input: RecordDoseInput }) =>
      api.post<DoseView>(`${base(householdId)}/doses/${doseId}/record`, input),
    onSuccess: invalidate,
  });
}

/* --------------------------------------------------------------- medicines */

export function useMedicines(householdId: string, filters: Record<string, string | boolean> = {}) {
  return useQuery({
    queryKey: [...qk.health(householdId), 'medicines', filters],
    queryFn: () =>
      api.getList<MedicineView>(`${base(householdId)}/medicines${qs({ ...filters, perPage: 100 })}`) as Promise<{
        data: MedicineView[];
        meta: ListMeta;
      }>,
    placeholderData: (previous) => previous,
  });
}

export function useCreateMedicine(householdId: string) {
  const invalidate = useHealthInvalidation(householdId);
  return useMutation({
    mutationFn: (input: CreateMedicineInput) =>
      api.post<MedicineView>(`${base(householdId)}/medicines`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateMedicine(householdId: string) {
  const invalidate = useHealthInvalidation(householdId);
  return useMutation({
    mutationFn: ({ medicineId, input }: { medicineId: string; input: UpdateMedicineInput }) =>
      api.patch<MedicineView>(`${base(householdId)}/medicines/${medicineId}`, input),
    onSuccess: invalidate,
  });
}

export function useRefillMedicine(householdId: string) {
  const invalidate = useHealthInvalidation(householdId);
  return useMutation({
    mutationFn: ({ medicineId, input }: { medicineId: string; input: RefillMedicineInput }) =>
      api.post<MedicineView>(`${base(householdId)}/medicines/${medicineId}/refill`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteMedicine(householdId: string) {
  const invalidate = useHealthInvalidation(householdId);
  return useMutation({
    mutationFn: (medicineId: string) => api.delete(`${base(householdId)}/medicines/${medicineId}`),
    onSuccess: invalidate,
  });
}

/* ------------------------------------------------------------ appointments */

export function useAppointments(householdId: string, filters: Record<string, string | boolean> = {}) {
  return useQuery({
    queryKey: [...qk.health(householdId), 'appointments', filters],
    queryFn: () =>
      api.getList<AppointmentView>(
        `${base(householdId)}/appointments${qs({ ...filters, perPage: 100 })}`,
      ) as Promise<{ data: AppointmentView[]; meta: ListMeta }>,
    placeholderData: (previous) => previous,
  });
}

export function useCreateAppointment(householdId: string) {
  const invalidate = useHealthInvalidation(householdId);
  return useMutation({
    mutationFn: (input: CreateAppointmentInput) =>
      api.post<AppointmentView>(`${base(householdId)}/appointments`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateAppointment(householdId: string) {
  const invalidate = useHealthInvalidation(householdId);
  return useMutation({
    mutationFn: ({ appointmentId, input }: { appointmentId: string; input: UpdateAppointmentInput }) =>
      api.patch<AppointmentView>(`${base(householdId)}/appointments/${appointmentId}`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteAppointment(householdId: string) {
  const invalidate = useHealthInvalidation(householdId);
  return useMutation({
    mutationFn: (appointmentId: string) =>
      api.delete(`${base(householdId)}/appointments/${appointmentId}`),
    onSuccess: invalidate,
  });
}

/* ----------------------------------------------------------------- doctors */

export function useDoctors(householdId: string) {
  return useQuery({
    queryKey: [...qk.health(householdId), 'doctors'],
    queryFn: () => api.get<DoctorView[]>(`${base(householdId)}/doctors`),
  });
}

export function useCreateDoctor(householdId: string) {
  const invalidate = useHealthInvalidation(householdId);
  return useMutation({
    mutationFn: (input: CreateDoctorInput) => api.post<DoctorView>(`${base(householdId)}/doctors`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteDoctor(householdId: string) {
  const invalidate = useHealthInvalidation(householdId);
  return useMutation({
    mutationFn: (doctorId: string) => api.delete(`${base(householdId)}/doctors/${doctorId}`),
    onSuccess: invalidate,
  });
}
