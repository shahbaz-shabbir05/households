import type { CreateTaskInput, ListMeta, Priority, TaskCategory, TaskStatus, UpdateTaskInput } from '@hms/shared';
import { api, qs } from '../../lib/api.js';

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  category: TaskCategory;
  assigneeMemberId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  estimatedMinutes: number | null;
  completedAt: string | null;
  completedByMemberId: string | null;
  notes: string | null;
  isRecurring: boolean;
  seriesId: string | null;
  occurrenceDate: string | null;
  isOverdue: boolean;
  createdAt: string;
}

export interface TaskFilters {
  open?: boolean;
  status?: TaskStatus;
  category?: TaskCategory;
  assigneeMemberId?: string;
  assignee?: 'me';
  overdue?: boolean;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
}

const base = (householdId: string) => `/households/${householdId}/tasks`;

export const tasksApi = {
  list: (householdId: string, filters: TaskFilters) =>
    api.getList<TaskView>(`${base(householdId)}${qs(filters as Record<string, string>)}`) as Promise<{
      data: TaskView[];
      meta: ListMeta;
    }>,

  create: (householdId: string, input: CreateTaskInput) =>
    api.post<TaskView>(base(householdId), input),

  update: (householdId: string, taskId: string, input: UpdateTaskInput) =>
    api.patch<TaskView>(`${base(householdId)}/${taskId}`, input),

  setCompleted: (householdId: string, taskId: string, completed: boolean) =>
    api.post<TaskView>(`${base(householdId)}/${taskId}/complete`, { completed }),

  remove: (householdId: string, taskId: string, scope: 'occurrence' | 'following' = 'occurrence') =>
    api.delete(`${base(householdId)}/${taskId}${qs({ scope })}`),

  stopRecurrence: (householdId: string, taskId: string) =>
    api.post(`${base(householdId)}/${taskId}/stop-recurrence`),
};
