/**
 * Shopping: the lists, and the inventory behind them.
 *
 * One destination with two tabs rather than two places, because "what do we
 * need?" and "what do we have?" are the same question asked from two sides.
 */

import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Boxes, Check, Minus, Package, Plus, ShoppingCart } from 'lucide-react';
import { createInventoryItemSchema, formatMoney, type InventoryCategory } from '@hms/shared';
import { useHousehold } from '../../app/session.js';
import { allows } from '../../app/permissions.js';
import { PageHeader } from '../../app/AppShell.js';
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
import {
  useAdjustInventory,
  useCreateInventoryItem,
  useCreateShoppingList,
  useInventory,
  useShoppingLists,
  type InventoryItemView,
} from './api.js';

type Tab = 'lists' | 'inventory';

export function ShoppingScreen() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'lists';

  return (
    <div>
      <PageHeader title="Shopping" subtitle="What you need, and what you already have" />

      <div className="mb-4 flex gap-2" role="tablist" aria-label="Shopping view">
        {(['lists', 'inventory'] as const).map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={tab === option}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('tab', option);
              setParams(next, { replace: true });
            }}
            className={cx(
              'rounded-full px-3.5 py-2 text-sm font-medium capitalize transition-colors',
              tab === option
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
            )}
          >
            {option === 'lists' ? 'Lists' : 'Inventory'}
          </button>
        ))}
      </div>

      {tab === 'lists' ? <ListsTab /> : <InventoryTab />}
    </div>
  );
}

function ListsTab() {
  const household = useHousehold();
  const toast = useToast();
  const query = useShoppingLists(household.id);
  const createList = useCreateShoppingList(household.id);
  const [name, setName] = useState('');

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      await createList.mutateAsync({ name: trimmed });
      setName('');
      toast.success('List created');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not create that list');
    }
  }

  if (query.isPending) return <ListSkeleton rows={3} />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : 'We could not load your lists.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const open = query.data.data.filter((l) => l.status === 'open');
  const done = query.data.data.filter((l) => l.status !== 'open');

  return (
    <div className="space-y-5">
      <form onSubmit={onCreate} className="flex gap-2">
        <label htmlFor="new-list" className="sr-only">New list name</label>
        <Input
          id="new-list"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New list, e.g. Weekly shop"
          autoComplete="off"
        />
        <Button type="submit" iconOnly aria-label="Create list" loading={createList.isPending}>
          <Plus className="h-5 w-5" />
        </Button>
      </form>

      {open.length === 0 && done.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart className="h-10 w-10" />}
          title="No shopping lists yet"
          description="Start one above. You can pull in whatever is running low with a single tap, and finishing the trip updates your inventory for you."
        />
      ) : (
        <>
          {open.length > 0 && (
            <ul className="space-y-2">
              {open.map((list) => (
                <li key={list.id}>
                  <Link to={`/home/shopping/${list.id}`}>
                    <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-slate-50">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-900">
                        <ShoppingCart className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{list.name}</p>
                        <p className="text-xs text-slate-500">
                          {list.itemCount === 0
                            ? 'Empty'
                            : `${list.itemCount - list.purchasedCount} left of ${list.itemCount}`}
                          {list.store && ` · ${list.store}`}
                        </p>
                      </div>
                      {list.estimatedTotalMinor > 0 && (
                        <span className="shrink-0 text-xs text-slate-500">
                          ≈ {formatMoney(list.estimatedTotalMinor, household.currency, household.locale)}
                        </span>
                      )}
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {done.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Completed
              </h2>
              <ul className="space-y-2">
                {done.map((list) => (
                  <li key={list.id}>
                    <Link to={`/home/shopping/${list.id}`}>
                      <Card className="flex items-center gap-3 p-3 opacity-75 transition-colors hover:bg-slate-50">
                        <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                        <p className="min-w-0 flex-1 truncate text-sm text-slate-600">{list.name}</p>
                        <span className="shrink-0 text-xs text-slate-400">
                          {list.purchasedCount} bought
                        </span>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function InventoryTab() {
  const household = useHousehold();
  const [lowOnly, setLowOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const query = useInventory(household.id, lowOnly ? { lowStock: true } : {});
  const canEdit = allows(household.role, 'viewShopping');

  if (query.isPending) return <ListSkeleton rows={5} />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : 'We could not load your inventory.'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const items = query.data.data;
  const lowCount = items.filter((i) => i.isLow).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setLowOnly((current) => !current)}
          aria-pressed={lowOnly}
          className={cx(
            'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
            lowOnly ? 'bg-danger text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200',
          )}
        >
          Running low{!lowOnly && lowCount > 0 && ` (${lowCount})`}
        </button>
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add item
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-10 w-10" />}
          title={lowOnly ? 'Nothing is running low' : 'Nothing tracked yet'}
          description={
            lowOnly
              ? 'Everything with a minimum set is above it.'
              : 'Add the things you buy regularly with a minimum, and we’ll tell you when they run low instead of you having to check.'
          }
          action={canEdit && !lowOnly ? <Button onClick={() => setAddOpen(true)}>Add an item</Button> : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <InventoryRow item={item} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}

      <AddInventorySheet open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function InventoryRow({ item, canEdit }: { item: InventoryItemView; canEdit: boolean }) {
  const household = useHousehold();
  const adjust = useAdjustInventory(household.id);

  return (
    <Card className={cx('flex items-center gap-3 p-3', item.isLow && 'ring-danger/30')}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <Package className="h-4 w-4" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
        <p className="text-xs text-slate-500">
          {item.quantity} {item.unit}
          {item.minQuantity !== null && ` · keep ${item.minQuantity}+`}
        </p>
        {(item.isLow || item.isExpired) && (
          <p className="mt-1 flex flex-wrap gap-1">
            {item.isLow && (
              <Badge tone="danger" icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}>
                Running low
              </Badge>
            )}
            {item.isExpired && <Badge tone="warning">Past its date</Badge>}
          </p>
        )}
      </div>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            iconOnly
            aria-label={`Use one ${item.name}`}
            disabled={item.quantity <= 0 || adjust.isPending}
            onClick={() => adjust.mutate({ itemId: item.id, delta: -1 })}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            iconOnly
            aria-label={`Add one ${item.name}`}
            disabled={adjust.isPending}
            onClick={() => adjust.mutate({ itemId: item.id, delta: 1 })}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
    </Card>
  );
}

const CATEGORIES: InventoryCategory[] = [
  'dairy', 'bakery', 'produce', 'meat', 'pantry', 'frozen', 'beverages',
  'snacks', 'spices', 'cleaning', 'toiletries', 'baby', 'pet', 'stationery', 'tools', 'other',
];

function AddInventorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const household = useHousehold();
  const toast = useToast();
  const createItem = useCreateInventoryItem(household.id);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    const form = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = createInventoryItemSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }

    try {
      await createItem.mutateAsync(parsed.data);
      toast.success(`${parsed.data.name} added`);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      toast.error(error instanceof ApiError ? error.message : 'Could not add that item');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add to inventory">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="What is it?" error={errors.name} required>
          {({ id, invalid }) => (
            <Input id={id} name="name" placeholder="e.g. Basmati rice" invalid={invalid} required />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="How much now?" error={errors.quantity}>
            {({ id }) => <Input id={id} name="quantity" inputMode="decimal" defaultValue="1" />}
          </Field>
          <Field label="Unit">
            {({ id }) => (
              <Select id={id} name="unit" defaultValue="piece">
                {['piece', 'pack', 'kg', 'g', 'litre', 'ml', 'dozen', 'bottle', 'box', 'bag', 'can'].map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field
          label="Tell me when it drops below"
          error={errors.minQuantity}
          hint="Leave empty to never be warned about this one."
        >
          {({ id }) => <Input id={id} name="minQuantity" inputMode="decimal" placeholder="e.g. 2" />}
        </Field>

        <Field label="Category">
          {({ id }) => (
            <Select id={id} name="category" defaultValue="other">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>
              ))}
            </Select>
          )}
        </Field>

        <Button type="submit" size="lg" loading={createItem.isPending} className="w-full">
          Add item
        </Button>
      </form>
    </Sheet>
  );
}
