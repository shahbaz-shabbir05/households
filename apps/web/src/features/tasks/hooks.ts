import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTaskInput, UpdateTaskInput } from '@hms/shared';
import { qk } from '../../lib/query-keys.js';
import { tasksApi, type TaskFilters, type TaskView } from './api.js';

export function useTasks(householdId: string, filters: TaskFilters) {
  return useQuery({
    queryKey: qk.taskList(householdId, filters),
    queryFn: () => tasksApi.list(householdId, filters),
    // Keeps the previous page visible while the next one loads, instead of
    // flashing a skeleton over content the user is already reading.
    placeholderData: (previous) => previous,
  });
}

/** Invalidates everything a task change can affect, without guessing filters. */
function useTaskInvalidation(householdId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.tasks(householdId) });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
  };
}

export function useCreateTask(householdId: string) {
  const invalidate = useTaskInvalidation(householdId);
  return useMutation({
    mutationFn: (input: CreateTaskInput) => tasksApi.create(householdId, input),
    onSuccess: invalidate,
  });
}

export function useUpdateTask(householdId: string) {
  const invalidate = useTaskInvalidation(householdId);
  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: UpdateTaskInput }) =>
      tasksApi.update(householdId, taskId, input),
    onSuccess: invalidate,
  });
}

/**
 * Ticking a task is the highest-frequency interaction in the product, so it
 * updates optimistically: on a slow connection the tick must feel instant, and
 * roll back visibly if the server refuses.
 */
export function useToggleTask(householdId: string) {
  const queryClient = useQueryClient();
  const invalidate = useTaskInvalidation(householdId);

  return useMutation({
    mutationFn: ({ taskId, completed }: { taskId: string; completed: boolean }) =>
      tasksApi.setCompleted(householdId, taskId, completed),

    onMutate: async ({ taskId, completed }) => {
      await queryClient.cancelQueries({ queryKey: qk.tasks(householdId) });
      const snapshot = queryClient.getQueriesData({ queryKey: qk.tasks(householdId) });

      queryClient.setQueriesData<{ data: TaskView[] }>({ queryKey: qk.tasks(householdId) }, (old) =>
        old
          ? {
              ...old,
              data: old.data.map((task) =>
                task.id === taskId
                  ? { ...task, status: completed ? 'completed' : 'pending', isOverdue: completed ? false : task.isOverdue }
                  : task,
              ),
            }
          : old,
      );

      return { snapshot };
    },

    onError: (_error, _variables, context) => {
      for (const [key, value] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, value);
      }
    },

    onSettled: invalidate,
  });
}

export function useDeleteTask(householdId: string) {
  const invalidate = useTaskInvalidation(householdId);
  return useMutation({
    mutationFn: ({ taskId, scope }: { taskId: string; scope?: 'occurrence' | 'following' }) =>
      tasksApi.remove(householdId, taskId, scope),
    onSuccess: invalidate,
  });
}
