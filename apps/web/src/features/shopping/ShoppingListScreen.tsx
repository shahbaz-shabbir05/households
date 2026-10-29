/**
 * A single shopping list, and the trip that completes it.
 *
 * This screen is the user-facing half of §46: ticking items and pressing
 * "Done shopping" updates the inventory and records the spend in one go, so
 * the household never has to remember to do those separately.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Plus, ShoppingCart, Sparkles, Trash2 } from 'lucide-react';
import { formatMoney, parseMoneyInput, type InventoryCategory } from '@hms/shared';
import { useHousehold } from '../../app/session.js';
import { allows } from '../../app/permissions.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListSkeleton,
  Select,
  Sheet,
  cx,
} from '../../components/ui/index.js';
import { useToast } from '../../components/ui/toast.js';
import { ApiError } from '../../lib/api.js';
import { todayIn } from '../../lib/format.js';
import {
  useAddLowStock,
  useAddShoppingItem,
  useCompleteTrip,
  useRemoveShoppingItem,
  useShoppingList,
  useUpdateShoppingItem,
  type ShoppingItemView,
} from './api.js';
import { countRestockable, resolvePurchasedIds } from './trip.js';

const CATEGORY_LABELS: Partial<Record<InventoryCategory, string>> = {
  dairy: 'Dairy',
  bakery: 'Bakery',
  produce: 'Fruit & veg',
  meat: 'Meat',
  pantry: 'Pantry',
  frozen: 'Frozen',
  beverages: 'Drinks',
  snacks: 'Snacks',
  spices: 'Spices',
  cleaning: 'Cleaning',
  toiletries: 'Toiletries',
  baby: 'Baby',
  pet: 'Pet',
  stationery: 'Stationery',
  tools: 'Tools',
  other: 'Other',
};

export function ShoppingListScreen() {
  const { listId = '' } = useParams();
  const household = useHousehold();
  const toast = useToast();
  const query = useShoppingList(household.id, listId);

  const addItem = useAddShoppingItem(household.id);
  const updateItem = useUpdateShoppingItem(household.id);
  const removeItem = useRemoveShoppingItem(household.id);
  const addLowStock = useAddLowStock(household.id);

  const [newItem, setNewItem] = useState('');
  const [tripOpen, setTripOpen] = useState(false);

  const list = query.data;
  const canSpend = allows(household.role, 'viewMoney');

  /** Grouped by category — roughly aisle order, which is how people shop. */
  const grouped = useMemo(() => {
    const groups = new Map<InventoryCategory, ShoppingItemView[]>();
    for (const item of list?.items ?? []) {
      groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    }
    return [...groups.entries()];
  }, [list?.items]);

  async function onAddItem(event: FormEvent) {
    event.preventDefault();
    const name = newItem.trim();
    if (!name) return;

    setNewItem('');
    try {
      await addItem.mutateAsync({ listId, input: { name, quantity: 1, priority: 'normal' } });
    } catch (error) {
      setNewItem(name);
      toast.error(error instanceof ApiError ? error.message : 'Could not add that');
    }
  }

  async function onToggle(item: ShoppingItemView) {
    try {
      await updateItem.mutateAsync({ listId, itemId: item.id, input: { isPurchased: !item.isPurchased } });
    } catch {
      toast.error('That didn’t save — please try again');
    }
  }

  if (query.isPending) return <ListSkeleton rows={5} />;
  if (query.isError || !list) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : 'We could not load that list.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const isOpen = list.status === 'open';
  const remaining = list.itemCount - list.purchasedCount;

  return (
    <div>
      <Link to="/home/shopping" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-600">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All lists
      </Link>

      <header className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900 lg:text-2xl">{list.name}</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {list.store && <span>{list.store} · </span>}
          {list.itemCount === 0
            ? 'Nothing on the list yet'
            : `${remaining} left of ${list.itemCount}`}
          {canSpend && list.estimatedTotalMinor > 0 && (
            <span> · about {formatMoney(list.estimatedTotalMinor, household.currency, household.locale)}</span>
          )}
        </p>
        {!isOpen && (
          <p className="mt-2">
            <Badge tone="success" icon={<Check className="h-3 w-3" aria-hidden="true" />}>Completed</Badge>
          </p>
        )}
      </header>

      {isOpen && (
        <div className="mb-4 space-y-3">
          <form onSubmit={onAddItem} className="flex gap-2">
            <label htmlFor="add-item" className="sr-only">Add an item</label>
            <Input
              id="add-item"
              value={newItem}
              onChange={(event) => setNewItem(event.target.value)}
              placeholder="Add an item…"
              autoComplete="off"
              enterKeyHint="done"
            />
            <Button type="submit" iconOnly aria-label="Add item" loading={addItem.isPending}>
              <Plus className="h-5 w-5" />
            </Button>
          </form>

          {/* The answer to "what are we out of?" without anyone remembering. */}
          <Button
            variant="secondary"
            size="sm"
            loading={addLowStock.isPending}
            onClick={() => {
              addLowStock.mutate(listId, {
                onSuccess: (result) =>
                  toast.success(
                    result.added === 0
                      ? 'Nothing else is running low'
                      : `Added ${result.added} item${result.added === 1 ? '' : 's'} that are running low`,
                  ),
                onError: () => toast.error('Could not check your inventory'),
              });
            }}
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Add what’s running low
          </Button>
        </div>
      )}

      {list.itemCount === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-10 w-10" />}
          title="Nothing on this list"
          description="Add items above, or pull in whatever is running low from your inventory."
        />
      ) : (
        <div className="space-y-5">
          {grouped.map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {CATEGORY_LABELS[category] ?? category}
              </h2>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item.id}>
                    <Card className="flex items-center gap-3 p-3">
                      <button
                        onClick={() => void onToggle(item)}
                        disabled={!isOpen}
                        aria-label={
                          item.isPurchased ? `Un-tick "${item.name}"` : `Tick off "${item.name}"`
                        }
                        className={cx(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 transition-colors',
                          item.isPurchased
                            ? 'bg-brand-600 text-white ring-brand-600'
                            : 'ring-slate-300 hover:ring-brand-500',
                          !isOpen && 'opacity-60',
                        )}
                      >
                        {item.isPurchased && <Check className="h-4 w-4" aria-hidden="true" />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <p
                          className={cx(
                            'truncate text-sm font-medium',
                            item.isPurchased ? 'text-slate-400 line-through' : 'text-slate-900',
                          )}
                        >
                          {item.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {item.quantity} {item.unit}
                          {/* Stated plainly: only linked items restock the pantry. */}
                          {item.inventoryItemId === null && ' · not tracked in inventory'}
                        </p>
                      </div>

                      {isOpen && (
                        <Button
                          variant="ghost"
                          iconOnly
                          aria-label={`Remove "${item.name}"`}
                          onClick={() => removeItem.mutate({ listId, itemId: item.id })}
                        >
                          <Trash2 className="h-4 w-4 text-slate-400" />
                        </Button>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {isOpen && list.itemCount > 0 && (
        <div className="mt-6">
          <Button size="lg" className="w-full" onClick={() => setTripOpen(true)}>
            Done shopping
          </Button>
          <p className="mt-2 text-center text-xs text-slate-500">
            Updates your inventory{canSpend && ' and records the spend'} in one step.
          </p>
        </div>
      )}

      <CompleteTripSheet
        open={tripOpen}
        onClose={() => setTripOpen(false)}
        listId={listId}
        items={list.items ?? []}
        canSpend={canSpend}
      />
    </div>
  );
}

function CompleteTripSheet({
  open,
  onClose,
  listId,
  items,
  canSpend,
}: {
  open: boolean;
  onClose: () => void;
  listId: string;
  items: ShoppingItemView[];
  canSpend: boolean;
}) {
  const household = useHousehold();
  const toast = useToast();
  const navigate = useNavigate();
  const completeTrip = useCompleteTrip(household.id);

  const [total, setTotal] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [recordExpense, setRecordExpense] = useState(canSpend);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const purchasedIds = resolvePurchasedIds(items);
  const trackedCount = countRestockable(items, purchasedIds);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});

    const amountMinor = recordExpense ? parseMoneyInput(total, household.currency) : undefined;
    if (recordExpense && amountMinor === null) {
      setErrors({ amountMinor: 'Enter what you spent' });
      return;
    }

    try {
      const result = await completeTrip.mutateAsync({
        listId,
        input: {
          purchasedItemIds: purchasedIds,
          recordExpense,
          ...(amountMinor !== undefined ? { amountMinor } : {}),
          paymentMethod: paymentMethod as never,
          expenseCategory: 'groceries',
          restockInventory: true,
          shoppedOn: todayIn(household.timezone),
        } as never,
      });

      toast.success(
        `${result.itemsPurchased} item${result.itemsPurchased === 1 ? '' : 's'} bought` +
          (result.itemsRestocked > 0 ? `, ${result.itemsRestocked} restocked` : ''),
      );
      onClose();
      navigate('/home/shopping');
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      toast.error(error instanceof ApiError ? error.message : 'Could not complete that trip');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Done shopping">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900">
          {purchasedIds.length} item{purchasedIds.length === 1 ? '' : 's'} bought
          {trackedCount > 0 && ` · ${trackedCount} will be added back to your inventory`}
        </div>

        {canSpend && (
          <>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={recordExpense}
                onChange={(event) => setRecordExpense(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Record what we spent
            </label>

            {recordExpense && (
              <>
                <Field label={`Total (${household.currency})`} error={errors.amountMinor} required>
                  {({ id, invalid }) => (
                    <Input
                      id={id}
                      // Brings up the numeric keypad rather than a full keyboard.
                      inputMode="decimal"
                      value={total}
                      onChange={(event) => setTotal(event.target.value)}
                      placeholder="4875"
                      invalid={invalid}
                      autoFocus
                    />
                  )}
                </Field>

                <Field label="How did you pay?">
                  {({ id }) => (
                    <Select id={id} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                      <option value="cash">Cash</option>
                      <option value="easypaisa">Easypaisa</option>
                      <option value="jazzcash">JazzCash</option>
                      <option value="debit_card">Debit card</option>
                      <option value="credit_card">Credit card</option>
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="other">Other</option>
                    </Select>
                  )}
                </Field>
              </>
            )}
          </>
        )}

        <Button type="submit" size="lg" loading={completeTrip.isPending} className="w-full">
          Finish
        </Button>
      </form>
    </Sheet>
  );
}
