/**
 * Query keys are household-prefixed, so switching household drops exactly the
 * right cache entries and a mutation can invalidate a whole resource without
 * guessing at filter permutations (docs/11).
 */

export const qk = {
  me: () => ['me'] as const,
  households: () => ['households'] as const,

  household: (id: string) => ['households', id] as const,
  dashboard: (id: string) => ['households', id, 'dashboard'] as const,
  members: (id: string) => ['households', id, 'members'] as const,

  tasks: (id: string) => ['households', id, 'tasks'] as const,
  taskList: (id: string, filters: unknown) => ['households', id, 'tasks', 'list', filters] as const,
  task: (id: string, taskId: string) => ['households', id, 'tasks', taskId] as const,

  events: (id: string) => ['households', id, 'events'] as const,
  eventList: (id: string, filters: unknown) => ['households', id, 'events', 'list', filters] as const,

  reminders: (id: string) => ['households', id, 'reminders'] as const,
  reminderList: (id: string, filters: unknown) =>
    ['households', id, 'reminders', 'list', filters] as const,

  notifications: (id: string) => ['households', id, 'notifications'] as const,
};
