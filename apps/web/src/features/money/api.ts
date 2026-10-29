import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateExpenseInput, ExpenseCategory, ListMeta, PaymentMethod } from '@hms/shared';
import { api, qs } from '../../lib/api.js';
import { qk } from '../../lib/query-keys.js';

export interface ExpenseView {
  id: string;
  amountMinor: number;
  currency: string;
  spentOn: string;
  category: ExpenseCategory;
  subcategory: string | null;
  paidByMemberId: string | null;
  paidByName: string | null;
  forMemberId: string | null;
  paymentMethod: PaymentMethod;
  merchant: string | null;
  description: string | null;
  createdAt: string;
}

export interface MonthlySummary {
  month: string;
  currency: string;
  totalMinor: number;
  previousMonthMinor: number;
  changePercent: number | null;
  byCategory: Array<{ category: ExpenseCategory; amountMinor: number; count: number }>;
  largest: ExpenseView[];
  expenseCount: number;
}

const base = (h: string) => `/households/${h}/expenses`;

export function useExpenses(householdId: string, filters: Record<string, string | number> = {}) {
  return useQuery({
    queryKey: [...qk.household(householdId), 'expenses', filters],
    queryFn: () =>
      api.getList<ExpenseView>(`${base(householdId)}${qs({ ...filters, perPage: 50 })}`) as Promise<{
        data: ExpenseView[];
        meta: ListMeta;
        totals?: { filteredAmountMinor: number; currency: string };
      }>,
    placeholderData: (previous) => previous,
  });
}

export function useExpenseSummary(householdId: string, month?: string) {
  return useQuery({
    queryKey: [...qk.household(householdId), 'expenses', 'summary', month ?? 'current'],
    queryFn: () => api.get<MonthlySummary>(`${base(householdId)}/summary${qs({ month })}`),
  });
}

export function useCreateExpense(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseInput) => api.post<ExpenseView>(base(householdId), input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...qk.household(householdId), 'expenses'] });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
    },
  });
}

export function useDeleteExpense(householdId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => api.delete(`${base(householdId)}/${expenseId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...qk.household(householdId), 'expenses'] });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
    },
  });
}
