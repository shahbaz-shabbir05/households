import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddShoppingItemInput,
  CompleteTripInput,
  CreateInventoryItemInput,
  CreateShoppingListInput,
  InventoryCategory,
  InventoryKind,
  ListMeta,
  Priority,
  ShoppingListStatus,
  Unit,
  UpdateShoppingItemInput,
} from '@hms/shared';
import { api, qs } from '../../lib/api.js';
import { qk } from '../../lib/query-keys.js';

export interface InventoryItemView {
  id: string;
  name: string;
  kind: InventoryKind;
  category: InventoryCategory;
  unit: Unit;
  quantity: number;
  minQuantity: number | null;
  location: string | null;
  expiryDate: string | null;
  brand: string | null;
  preferredBrand: string | null;
  estimatedPriceMinor: number | null;
  restockIntervalDays: number | null;
  lastPurchasedOn: string | null;
  notes: string | null;
  isLow: boolean;
  isRestockDue: boolean;
  isExpired: boolean;
}

export interface ShoppingItemView {
  id: string;
  inventoryItemId: string | null;
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: Unit;
  priority: Priority;
  isPurchased: boolean;
  actualPriceMinor: number | null;
  notes: string | null;
}

export interface ShoppingListView {
  id: string;
  name: string;
  store: string | null;
  status: ShoppingListStatus;
  shopperMemberId: string | null;
  completedAt: string | null;
  itemCount: number;
  purchasedCount: number;
  estimatedTotalMinor: number;
  items?: ShoppingItemView[];
  createdAt: string;
}

export interface TripResult {
  list: ShoppingListView;
  tripId: string;
  expense: { id: string; amountMinor: number; currency: string } | null;
  itemsPurchased: number;
  itemsRestocked: number;
}

const inventoryBase = (h: string) => `/households/${h}/inventory`;
const listsBase = (h: string) => `/households/${h}/shopping-lists`;

/* --------------------------------------------------------------- inventory */

export function useInventory(householdId: string, filters: Record<string, string | boolean | number> = {}) {
  return useQuery({
    queryKey: [...qk.household(householdId), 'inventory', filters],
    queryFn: () =>
      api.getList<InventoryItemView>(`${inventoryBase(householdId)}${qs({ ...filters, perPage: 100 })}`) as Promise<{
        data: InventoryItemView[];
        meta: ListMeta;
      }>,
    placeholderData: (previous) => previous,
  });
}

function useInventoryInvalidation(householdId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [...qk.household(householdId), 'inventory'] });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
  };
}

export function useCreateInventoryItem(householdId: string) {
  const invalidate = useInventoryInvalidation(householdId);
  return useMutation({
    mutationFn: (input: CreateInventoryItemInput) =>
      api.post<InventoryItemView>(inventoryBase(householdId), input),
    onSuccess: invalidate,
  });
}

export function useAdjustInventory(householdId: string) {
  const invalidate = useInventoryInvalidation(householdId);
  return useMutation({
    mutationFn: ({ itemId, delta, setTo }: { itemId: string; delta?: number; setTo?: number }) =>
      api.post<InventoryItemView>(`${inventoryBase(householdId)}/${itemId}/adjust`, { delta, setTo }),
    onSuccess: invalidate,
  });
}

export function useDeleteInventoryItem(householdId: string) {
  const invalidate = useInventoryInvalidation(householdId);
  return useMutation({
    mutationFn: (itemId: string) => api.delete(`${inventoryBase(householdId)}/${itemId}`),
    onSuccess: invalidate,
  });
}

/* ---------------------------------------------------------------- shopping */

export function useShoppingLists(householdId: string, status?: ShoppingListStatus) {
  return useQuery({
    queryKey: [...qk.household(householdId), 'shopping-lists', { status }],
    queryFn: () =>
      api.getList<ShoppingListView>(`${listsBase(householdId)}${qs({ status, perPage: 50 })}`),
  });
}

export function useShoppingList(householdId: string, listId: string) {
  return useQuery({
    queryKey: [...qk.household(householdId), 'shopping-lists', listId],
    queryFn: () => api.get<ShoppingListView>(`${listsBase(householdId)}/${listId}`),
  });
}

/**
 * A change to a list can move stock, spend and the dashboard, so everything
 * downstream is invalidated together rather than guessing which parts moved.
 */
function useShoppingInvalidation(householdId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [...qk.household(householdId), 'shopping-lists'] });
    void queryClient.invalidateQueries({ queryKey: [...qk.household(householdId), 'inventory'] });
    void queryClient.invalidateQueries({ queryKey: [...qk.household(householdId), 'expenses'] });
    void queryClient.invalidateQueries({ queryKey: qk.dashboard(householdId) });
  };
}

export function useCreateShoppingList(householdId: string) {
  const invalidate = useShoppingInvalidation(householdId);
  return useMutation({
    mutationFn: (input: CreateShoppingListInput) =>
      api.post<ShoppingListView>(listsBase(householdId), input),
    onSuccess: invalidate,
  });
}

export function useAddShoppingItem(householdId: string) {
  const invalidate = useShoppingInvalidation(householdId);
  return useMutation({
    mutationFn: ({ listId, input }: { listId: string; input: AddShoppingItemInput }) =>
      api.post<ShoppingItemView>(`${listsBase(householdId)}/${listId}/items`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateShoppingItem(householdId: string) {
  const invalidate = useShoppingInvalidation(householdId);
  return useMutation({
    mutationFn: ({
      listId,
      itemId,
      input,
    }: {
      listId: string;
      itemId: string;
      input: UpdateShoppingItemInput;
    }) => api.patch<ShoppingItemView>(`${listsBase(householdId)}/${listId}/items/${itemId}`, input),
    onSuccess: invalidate,
  });
}

export function useRemoveShoppingItem(householdId: string) {
  const invalidate = useShoppingInvalidation(householdId);
  return useMutation({
    mutationFn: ({ listId, itemId }: { listId: string; itemId: string }) =>
      api.delete(`${listsBase(householdId)}/${listId}/items/${itemId}`),
    onSuccess: invalidate,
  });
}

export function useAddLowStock(householdId: string) {
  const invalidate = useShoppingInvalidation(householdId);
  return useMutation({
    mutationFn: (listId: string) =>
      api.post<{ added: number; items: ShoppingItemView[] }>(
        `${listsBase(householdId)}/${listId}/add-low-stock`,
        { includeRestockDue: true },
      ),
    onSuccess: invalidate,
  });
}

/** The trip workflow: one call, four effects, all or nothing. */
export function useCompleteTrip(householdId: string) {
  const invalidate = useShoppingInvalidation(householdId);
  return useMutation({
    mutationFn: ({ listId, input }: { listId: string; input: CompleteTripInput }) =>
      api.post<TripResult>(`${listsBase(householdId)}/${listId}/complete`, input),
    onSuccess: invalidate,
  });
}
