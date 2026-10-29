import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BillStatus,
  BillType,
  CreateBillInput,
  CreateBudgetInput,
  ExpenseCategory,
  ListMeta,
  PayBillInput,
  PaymentMethod,
} from '@hms/shared';
import { api, qs } from '../../lib/api.js';
import { qk } from '../../lib/query-keys.js';

export interface BillView {
  id: string;
  name: string;
  billType: BillType;
  providerId: string | null;
  providerName: string | null;
  accountNumber: string | null;
  dueDate: string;
  amountMinor: number;
  currency: string;
  paidAmountMinor: number | null;
  paidOn: string | null;
  paymentMethod: PaymentMethod | null;
  expenseId: string | null;
  status: BillStatus;
  expenseCategory: ExpenseCategory;
  ownerMemberId: string | null;
  remindDaysBefore: number;
  isRecurring: boolean;
  daysOverdue: number;
  notes: string | null;
}

export interface BudgetStatusView {
  id: string;
  category: ExpenseCategory | null;
  amountMinor: number;
  currency: string;
  warnAtPercent: number;
  month: string;
  spentMinor: number;
  remainingMinor: number;
  usedPercent: number | null;
  state: 'under' | 'approaching' | 'over';
}

const billsBase = (h: string) => `/households/${h}/bills`;
const budgetsBase = (h: string) => `/households/${h}/budgets`;

export function useBills(householdId: string, filters: Record<string, string | boolean> = {}) {
  return useQuery({
    queryKey: [...qk.household(householdId), 'bills', filters],
    queryFn: () =>
      api.getList<BillView>(`${billsBase(householdId)}${qs({ ...filters, perPage: 100 })}`) as Promise<{
        data: BillView[];
        meta: ListMeta;
        totals?: { outstandingAmountMinor: number; currency: string };
      }>,
    placeholderData: (previous) => previous,
  });
}

/**
 * Paying a bill moves the ledger, the budgets and the dashboard, so all of it
 * is invalidated together rather than guessing which parts changed.
 */
function useMoneyInvalidation(householdId: string) {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['bills', 'budgets', 'expenses'] as const) {
      void queryClient.invalidateQueries({ queryKey: [...qk.household(householdId), key] });
    }
    void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
    void queryClient.invalidateQueries({ queryKey: qk.reminders(householdId) });
  };
}

export function useCreateBill(householdId: string) {
  const invalidate = useMoneyInvalidation(householdId);
  return useMutation({
    mutationFn: (input: CreateBillInput) => api.post<BillView>(billsBase(householdId), input),
    onSuccess: invalidate,
  });
}

export function usePayBill(householdId: string) {
  const invalidate = useMoneyInvalidation(householdId);
  return useMutation({
    mutationFn: ({ billId, input }: { billId: string; input: PayBillInput }) =>
      api.post<{ bill: BillView; expense: { amountMinor: number; currency: string } | null }>(
        `${billsBase(householdId)}/${billId}/pay`,
        input,
      ),
    onSuccess: invalidate,
  });
}

export function useUnpayBill(householdId: string) {
  const invalidate = useMoneyInvalidation(householdId);
  return useMutation({
    mutationFn: (billId: string) => api.post<BillView>(`${billsBase(householdId)}/${billId}/unpay`),
    onSuccess: invalidate,
  });
}

export function useDeleteBill(householdId: string) {
  const invalidate = useMoneyInvalidation(householdId);
  return useMutation({
    mutationFn: (billId: string) => api.delete(`${billsBase(householdId)}/${billId}`),
    onSuccess: invalidate,
  });
}

export function useBudgetStatus(householdId: string, month?: string) {
  return useQuery({
    queryKey: [...qk.household(householdId), 'budgets', 'status', month ?? 'current'],
    queryFn: () => api.get<BudgetStatusView[]>(`${budgetsBase(householdId)}/status${qs({ month })}`),
  });
}

export function useCreateBudget(householdId: string) {
  const invalidate = useMoneyInvalidation(householdId);
  return useMutation({
    mutationFn: (input: CreateBudgetInput) => api.post(budgetsBase(householdId), input),
    onSuccess: invalidate,
  });
}

export function useDeleteBudget(householdId: string) {
  const invalidate = useMoneyInvalidation(householdId);
  return useMutation({
    mutationFn: (budgetId: string) => api.delete(`${budgetsBase(householdId)}/${budgetId}`),
    onSuccess: invalidate,
  });
}
