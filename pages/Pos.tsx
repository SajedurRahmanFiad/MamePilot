import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Pause,
  Play,
  Printer,
  ShoppingCart,
  PackageOpen,
  Trash2,
  Minus,
  Plus,
  X,
  Search,
  ChevronRight,
  Edit,
  UserPlus,
  UserRound,
  ReceiptText,
  ArrowRight,
  Check,
} from 'lucide-react';
import { formatCurrency } from '../constants';
import { theme } from '../theme';
import { Button, IconButton } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { CustomerCreateModal } from '../components/ContactCreateModal';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { handlePrintOrder } from '../src/utils/printUtils';
import { sanitizePhoneInput } from '../utils';
import {
  fetchProducts,
  fetchPosInit,
  fetchPosPendingSales,
  createPosOrder,
  cancelPosPendingSale,
  savePosDraft,
  fetchPosDraft,
  clearPosDraft,
  fetchCustomersPage,
  type PosPaymentMethod,
  type PosCreatedOrder,
} from '../src/services/supabaseQueries';
import type { Product, Order, Customer } from '../types';

type CustomerSearchOption = Pick<Customer, 'id' | 'name'> & Partial<Customer>;

type CartLine = {
  key: string;
  productId?: string;
  productName: string;
  originalRate: number;
  rate: number;
  quantity: number;
};

const WALKIN_ID = 'walkin-customer';
const FALLBACK_METHODS: PosPaymentMethod[] = [{ id: 'cash', name: 'Cash', label: 'Cash' }];
const WALKIN_CUSTOMER: CustomerSearchOption = {
  id: WALKIN_ID,
  name: 'Walk-in Customer',
  phone: '',
  address: '',
  totalOrders: 0,
  dueAmount: 0,
};

const toNum = (value: string | number): number => {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(n) ? 0 : n;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export default function Pos() {
  const navigate = useNavigate();
  const toast = useToastNotifications();
  const { can } = useRolePermissions();
  const permission = can('orders.create');

  // ---- Customer selection (identical logic & visuals to the order form) ----
  // The walk-in customer is the default selection so every sale has a valid
  // customer unless the cashier explicitly picks another one.
  const [customer, setCustomer] = useState<CustomerSearchOption | null>(WALKIN_CUSTOMER);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [custSearchTerm, setCustSearchTerm] = useState('');
  const [debouncedCustSearch, setDebouncedCustSearch] = useState('');
  const [isCustomerCreateOpen, setIsCustomerCreateOpen] = useState(false);
  const [customerCreateInitialValues, setCustomerCreateInitialValues] = useState<Partial<Pick<Customer, 'name' | 'phone' | 'address'>>>();
  const [customerToEdit, setCustomerToEdit] = useState<CustomerSearchOption | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedCustSearch(custSearchTerm.trim()), 300);
    return () => clearTimeout(t);
  }, [custSearchTerm]);

  const custPageSize = 20;
  const { data: customersPage, isFetching: customersFetching } = useQuery({
    queryKey: ['customers', 1, custPageSize, debouncedCustSearch],
    queryFn: ({ signal }) => fetchCustomersPage(1, custPageSize, debouncedCustSearch, undefined, { signal }),
    enabled: showCustomerSearch,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const baseVisibleCustomers = React.useMemo<CustomerSearchOption[]>(() => customersPage?.data || [], [customersPage?.data]);
  const allVisibleCustomers = useMemo(() => {
    if (!customer) return baseVisibleCustomers;
    return baseVisibleCustomers.some((c) => c.id === customer.id) ? baseVisibleCustomers : [customer, ...baseVisibleCustomers];
  }, [baseVisibleCustomers, customer]);

  const handleCustomerSelect = (c: CustomerSearchOption) => {
    setCustomer(c);
    setShowCustomerSearch(false);
    setCustSearchTerm('');
  };

  const selectWalkIn = () => {
    setCustomer({ ...WALKIN_CUSTOMER });
    setShowCustomerSearch(false);
    setCustSearchTerm('');
  };

  const customerDisplay = customer
    ? customer.id === WALKIN_ID
      ? { name: 'Walk-in Customer', phone: 'No permanent record' }
      : { name: customer.name, phone: customer.phone || '' }
    : null;

  // ---- Product selection ----
  const [search, setSearch] = useState('');
  const [addQty, setAddQty] = useState<Record<string, string>>({});
  const productsQuery = useQuery({ queryKey: ['pos-products'], queryFn: () => fetchProducts() });
  const products: Product[] = productsQuery.data ?? [];
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  // ---- Cart ----
  const [cart, setCart] = useState<CartLine[]>([]);
  const lineCounter = useRef(0);
  const nextKey = () => `line-${++lineCounter.current}`;

  const addToCart = (product: Product) => {
    const qty = round2(toNum(addQty[product.id] ?? '1'));
    if (qty <= 0) {
      toast.error('Enter a quantity greater than zero to add.');
      return;
    }
    const inCart = cart.filter((l) => l.productId === product.id).reduce((sum, l) => sum + l.quantity, 0);
    const available = Math.max(0, product.stock) - inCart;
    if (qty > available) {
      toast.error(`Only ${Math.max(0, product.stock).toLocaleString()} in stock for ${product.name}.`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id && l.rate === product.salePrice);
      if (existing) {
        return prev.map((l) => (l.key === existing.key ? { ...l, quantity: round2(l.quantity + qty) } : l));
      }
      return [...prev, { key: nextKey(), productId: product.id, productName: product.name, originalRate: product.salePrice, rate: product.salePrice, quantity: qty }];
    });
  };

  const updateLineQuantity = (key: string, delta: number) => {
    setCart((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const nextQty = round2(line.quantity + delta);
        if (nextQty < 0 || nextQty === line.quantity) return line;
        if (delta > 0 && line.productId) {
          const product = products.find((p) => p.id === line.productId);
          if (product && nextQty > Math.max(0, product.stock)) {
            toast.error(`Only ${Math.max(0, product.stock).toLocaleString()} in stock for ${product.name}.`);
            return line;
          }
        }
        return { ...line, quantity: nextQty };
      }),
    );
  };

  const updateLineRate = (key: string, rate: number) => {
    setCart((prev) => prev.map((line) => (line.key === key ? { ...line, rate: Math.max(0, round2(rate)) } : line)));
  };

  const removeLine = (key: string) => setCart((prev) => prev.filter((l) => l.key !== key));

  const productById = (id?: string) => products.find((p) => p.id === id);
  const productImage = (id?: string) => productById(id)?.image || '';

  // ---- Discount (fixed amount or percentage) ----
  const [discountMode, setDiscountMode] = useState<'fixed' | 'percent'>('fixed');
  const [discountValue, setDiscountValue] = useState('0');
  const subtotal = round2(cart.reduce((sum, l) => sum + l.rate * l.quantity, 0));
  const discountAmount = useMemo(() => {
    if (discountMode === 'percent') {
      return round2(Math.min(subtotal, Math.max(0, subtotal * (toNum(discountValue) / 100))));
    }
    return round2(Math.min(subtotal, Math.max(0, toNum(discountValue))));
  }, [discountMode, discountValue, subtotal]);

  // ---- VAT ----
  const [vatRate, setVatRate] = useState('0');
  const vatAmount = round2(Math.max(0, subtotal - discountAmount) * (toNum(vatRate) / 100));
  const payable = round2(subtotal - discountAmount + vatAmount);

  // ---- Payment split + received/change (checkout modal) ----
  const initQuery = useQuery({ queryKey: ['pos-init'], queryFn: fetchPosInit });
  const paymentMethods: PosPaymentMethod[] = (initQuery.data?.paymentMethods.length ? initQuery.data.paymentMethods : FALLBACK_METHODS) ?? FALLBACK_METHODS;
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [activeMethods, setActiveMethods] = useState<Record<string, boolean>>({});
  const [received, setReceived] = useState('');
  const prevPayableRef = useRef(payable);

  useEffect(() => {
    const current = toNum(received);
    if (received === '' || current === prevPayableRef.current) {
      setReceived(String(payable));
    }
    prevPayableRef.current = payable;
  }, [payable, received]);

  useEffect(() => {
    setAllocations({});
    setActiveMethods(Object.fromEntries(paymentMethods.map((m) => [m.id, m.id === 'cash'])));
  }, [paymentMethods]);

  const togglePaymentMethod = (id: string) => {
    const willDisable = activeMethods[id] !== false;
    const activeCount = paymentMethods.filter((m) => activeMethods[m.id] !== false).length;
    if (willDisable && activeCount <= 1) return;
    setActiveMethods((prev) => ({ ...prev, [id]: !willDisable }));
    setAllocations({});
  };

  const allocated = round2(paymentMethods.reduce((sum, m) => sum + toNum(allocations[m.id] ?? ''), 0));
  const balance = round2(payable - allocated);
  const receivedNum = round2(toNum(received));
  const change = round2(Math.max(0, receivedNum - payable));
  const allocPct = payable > 0 ? Math.min(100, (allocated / payable) * 100) : 0;
  const activePaymentMethods = paymentMethods.filter((m) => activeMethods[m.id] !== false);

  // ---- Notes ----
  const [note, setNote] = useState('');

  // ---- Draft ----
  const [hydrated, setHydrated] = useState(false);
  const [resumedHoldId, setResumedHoldId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const draft = await fetchPosDraft();
        if (cancelled) return;
        if (draft && draft.items.length) {
          setCart(draft.items.map((item) => ({ key: nextKey(), productId: item.productId, productName: item.productName, originalRate: (item as unknown as { originalRate?: number }).originalRate ?? item.rate, rate: item.rate, quantity: item.quantity })));
          setVatRate(String(draft.vatRate ?? 0));
          setDiscountMode(draft.discountMode ?? 'fixed');
          setDiscountValue(String(draft.discountValue ?? 0));
          setNote(draft.note ?? '');
          if (draft.customerId) {
            setCustomer({ id: draft.customerId, name: draft.customerId === WALKIN_ID ? 'Walk-in Customer' : '', phone: '', totalOrders: 0, dueAmount: 0 });
          }
          if (draft.allocations) {
            const next: Record<string, string> = {};
            draft.allocations.forEach((a) => {
              next[a.method] = String(a.amount);
            });
            setAllocations(next);
          }
          if (typeof draft.received === 'number' && draft.received > 0) {
            setReceived(String(draft.received));
          }
        }
      } catch {
        // Draft restore is best-effort
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const buildDraftEnvelope = (): Parameters<typeof savePosDraft>[0] => ({
    customerId: customer?.id ?? null,
    items: cart.map((l) => ({ productId: l.productId, productName: l.productName, originalRate: l.originalRate, rate: l.rate, quantity: l.quantity })),
    vatRate: toNum(vatRate),
    discountMode,
    discountValue: toNum(discountValue),
    note: note.trim() ? note.trim() : null,
    allocations: paymentMethods
      .map((m) => ({ method: m.id, amount: round2(toNum(allocations[m.id] ?? '')) }))
      .filter((a) => a.amount > 0),
    received: receivedNum,
  });

  useEffect(() => {
    if (!hydrated) return;
    if (cart.length === 0 && !note.trim()) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void savePosDraft(buildDraftEnvelope()).catch(() => undefined);
    }, 1000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [cart, note, vatRate, discountMode, discountValue, allocations, received, customer?.id, hydrated]);

  // ---- Held sales ----
  const [showPending, setShowPending] = useState(false);
  const pendingQuery = useQuery({ queryKey: ['pos-pending'], queryFn: fetchPosPendingSales });
  const pendingSales: Order[] = pendingQuery.data ?? [];

  const resumeHold = (order: Order) => {
    setCart(
      (order.items ?? []).map((item) => ({
        key: nextKey(),
        productId: item.productId,
        productName: item.productName,
        originalRate: item.rate,
        rate: item.rate,
        quantity: item.quantity,
      })),
    );
    setVatRate(String((order as unknown as { vatRate?: number }).vatRate ?? 0));
    setDiscountMode('fixed');
    setDiscountValue(String(order.discount ?? 0));
    setNote(order.notes ?? '');
    setCustomer(order.customerId ? { id: order.customerId, name: order.customerName ?? '', phone: order.customerPhone ?? '', totalOrders: 0, dueAmount: 0 } : null);
    setResumedHoldId(order.id);
    setShowPending(false);
    toast.info(`Resumed order ${order.orderNumber}`);
  };

  const cancelHold = async (order: Order) => {
    try {
      await cancelPosPendingSale(order.id);
      toast.success(`Order ${order.orderNumber} cancelled`);
      pendingQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel the held sale.');
    }
  };

  // ---- Checkout ----
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<PosCreatedOrder | null>(null);

  const cashPrefilled = useRef(false);

  useEffect(() => {
    if (!checkoutOpen) {
      cashPrefilled.current = false;
      return;
    }
    if (cashPrefilled.current) return;
    if (paymentMethods.some((m) => toNum(allocations[m.id] ?? '') > 0)) return;
    const cash = paymentMethods.find((m) => m.id === 'cash');
    if (cash && activeMethods['cash'] !== false) {
      setAllocations((a) => ({ ...a, [cash.id]: String(payable) }));
    }
    cashPrefilled.current = true;
  }, [checkoutOpen, payable, allocations, activeMethods, paymentMethods]);

  const clearCart = async () => {
    setCart([]);
    setNote('');
    setDiscountMode('fixed');
    setDiscountValue('0');
    setVatRate('0');
    setAllocations({});
    setReceived('');
    setCustomer({ ...WALKIN_CUSTOMER });
    setResumedHoldId(null);
    setCheckoutOpen(false);
    if (hydrated) {
      try {
        await clearPosDraft();
      } catch {
        // Ignore
      }
    }
  };

  const tenderedRows = (): { method: string; amount: number }[] => {
    const rows = paymentMethods
      .map((m) => ({ method: m.id, amount: round2(toNum(allocations[m.id] ?? '')) }))
      .filter((r) => r.amount > 0);
    const excess = round2(receivedNum - payable);
    if (excess > 0) {
      const cashIndex = rows.findIndex((r) => r.method.toLowerCase() === 'cash');
      if (cashIndex >= 0) {
        rows[cashIndex] = { ...rows[cashIndex], amount: round2(rows[cashIndex].amount + excess) };
      } else if (rows.length > 0) {
        rows[0] = { ...rows[0], amount: round2(rows[0].amount + excess) };
      }
    }
    return rows;
  };

  const openCheckout = () => {
    if (cart.length === 0) {
      toast.error('Add at least one item to the sale.');
      return;
    }
    setCheckoutOpen(true);
  };

  const completeSale = async () => {
    if (!customer) {
      toast.error('Select a customer or use the Walk-in Customer option first.');
      return;
    }
    if (balance !== 0) {
      toast.error(balance > 0 ? `Allocate the remaining ${formatCurrency(balance)} across payment methods.` : `Payment allocation exceeds the payable by ${formatCurrency(-balance)}.`);
      return;
    }
    if (receivedNum < payable) {
      toast.error(`Amount received (${formatCurrency(receivedNum)}) is less than the payable (${formatCurrency(payable)}).`);
      return;
    }
    setSubmitting(true);
    try {
      const order = await createPosOrder({
        customerId: customer?.id ?? undefined,
        items: cart.map((l) => ({ productId: l.productId, productName: l.productName, rate: l.rate, quantity: l.quantity, amount: round2(l.rate * l.quantity) })),
        vatRate: toNum(vatRate),
        discount: discountAmount,
        tenders: tenderedRows(),
        notes: note.trim() ? note.trim() : null,
      });
      if (resumedHoldId) {
        try {
          await cancelPosPendingSale(resumedHoldId);
        } catch {
          // The new sale is already complete; the old hold is best-effort cancelled
        }
      }
      await clearCart();
      pendingQuery.refetch();
      if (order.status === 'On Hold') {
        toast.info(`Order ${order.orderNumber} placed on hold.`);
      } else {
        setReceipt(order);
        toast.success(`Order ${order.orderNumber} completed`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not complete the sale.');
    } finally {
      setSubmitting(false);
    }
  };

  const holdSale = async () => {
    if (!customer) {
      toast.error('Select a customer or use the Walk-in Customer option first.');
      return;
    }
    if (cart.length === 0) {
      toast.error('Add at least one item to the sale.');
      return;
    }
    setSubmitting(true);
    try {
      const order = await createPosOrder({
        customerId: customer?.id ?? undefined,
        items: cart.map((l) => ({ productId: l.productId, productName: l.productName, rate: l.rate, quantity: l.quantity, amount: round2(l.rate * l.quantity) })),
        vatRate: toNum(vatRate),
        discount: discountAmount,
        hold: true,
        notes: note.trim() ? note.trim() : null,
      });
      if (resumedHoldId) {
        try {
          await cancelPosPendingSale(resumedHoldId);
        } catch {
          // Best-effort: the previous hold is replaced by the new one
        }
      }
      await clearCart();
      pendingQuery.refetch();
      toast.info(`Order ${order.orderNumber} placed on hold.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not hold the sale.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!permission) {
    return (
      <div className="p-8 lg:p-10 text-center text-gray-500">
        You do not have permission to create orders. Contact an administrator.
      </div>
    );
  }

  const moneyRow = (label: string, value: number, bold = false, accent = 'text-gray-600') => (
    <div className={`flex items-center justify-between ${bold ? 'text-base font-bold text-gray-900' : `text-sm ${accent}`}`}>
      <span>{label}</span>
      <span>{formatCurrency(value)}</span>
    </div>
  );

  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <div className="min-h-full flex flex-col lg:h-full lg:overflow-hidden">
      <div className="flex-1 min-h-0 px-4 lg:px-6 py-4 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 lg:gap-5">
        {/* ================= MAIN: Product selection ================= */}
        <Card className="min-h-0 flex flex-col p-4">
          <div className="flex items-center gap-3 mb-4 flex-shrink-0">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products..."
                className={`${theme.inputs.base} pl-9`}
              />
            </div>
            <span className="text-xs text-gray-400 whitespace-nowrap">{filteredProducts.length} products</span>
          </div>

          <div className="min-h-0 lg:overflow-y-auto pr-1">
            {productsQuery.isError && <p className="text-sm text-red-500">Could not load products. Refresh and try again.</p>}
            {productsQuery.isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                {filteredProducts.map((product) => {
                  const outOfStock = product.stock <= 0;
                  return (
                    <div
                      key={product.id}
                      className={`rounded-lg border p-3 flex flex-col gap-2 ${outOfStock ? 'border-gray-100 bg-gray-50 opacity-60' : 'border-gray-200'}`}
                    >
                      <div className="h-20 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={product.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <PackageOpen size={22} className="text-gray-300" />
                        )}
                      </div>
                      <div className="text-sm font-semibold text-gray-800 leading-tight line-clamp-2">{product.name}</div>
                      <span className={`text-xs sm:hidden ${outOfStock ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                        {outOfStock ? 'Out of stock' : `Stock: ${Math.max(0, product.stock).toLocaleString()}`}
                      </span>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="text-base font-bold text-gray-900">{formatCurrency(product.salePrice)}</span>
                        <span className={`text-xs hidden sm:inline ${outOfStock ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                          {outOfStock ? 'Out of stock' : `Stock: ${Math.max(0, product.stock).toLocaleString()}`}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-1.5">
                        <div className="flex items-center border border-gray-200 rounded-lg w-full sm:w-auto">
                          <button
                            type="button"
                            className="flex-1 sm:flex-none px-2 py-1.5 text-gray-500 hover:text-gray-800"
                            onClick={() =>
                              setAddQty((q) => ({ ...q, [product.id]: String(Math.max(1, round2(toNum(q[product.id] ?? '1') - 1))) }))
                            }
                          >
                            <Minus size={13} />
                          </button>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={addQty[product.id] ?? '1'}
                            onChange={(e) => {
                              const v = e.target.value;
                              setAddQty((q) => ({ ...q, [product.id]: v === '' ? '' : String(Math.max(1, Math.floor(toNum(v)))) }));
                            }}
                            className="flex-1 min-w-0 w-10 text-center text-sm font-semibold text-gray-800 outline-none"
                          />
                          <button
                            type="button"
                            className="flex-1 sm:flex-none px-2 py-1.5 text-gray-500 hover:text-gray-800"
                            onClick={() =>
                              setAddQty((q) => ({ ...q, [product.id]: String(Math.max(1, round2(toNum(q[product.id] ?? '1') + 1))) }))
                            }
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                        <Button
                          size="sm"
                          className="w-full sm:flex-1"
                          icon={<Plus size={14} />}
                          disabled={outOfStock}
                          onClick={() => addToCart(product)}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {filteredProducts.length === 0 && (
                  <div className="col-span-full text-sm text-gray-400 text-center py-10">
                    <PackageOpen size={28} className="mx-auto mb-2 text-gray-300" />
                    No products match your search.
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* ================= RIGHT: Current Order ================= */}
        <Card className="min-h-0 flex flex-col p-4">
          <div className="flex items-center justify-between flex-shrink-0">
            <h3 className="text-sm font-bold text-gray-800 tracking-tight">Current Order</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPending((s) => !s)}
                className="text-[11px] font-bold text-gray-400 hover:text-gray-700 flex items-center gap-1 transition"
                title="Held sales"
              >
                <ReceiptText size={13} /> {pendingSales.length > 0 ? `Held ${pendingSales.length}` : 'Held'}
              </button>
              <button onClick={() => void clearCart()} className="text-[11px] font-bold text-gray-400 hover:text-red-500 transition">
                Clear
              </button>
            </div>
          </div>

          {/* Customer selector (moved from the left column) */}
          <div className="mt-3 relative flex-shrink-0">
            <button
              onClick={() => setShowCustomerSearch(!showCustomerSearch)}
              className="w-full text-left px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl hover:bg-white focus:ring-2 focus:ring-[#3c5a82] transition-all flex justify-between items-center group"
            >
              {customerDisplay ? (
                <div className="flex-1 overflow-hidden">
                  <span className="font-bold block text-sm text-gray-900">{customerDisplay.name}</span>
                  <p className="text-[10px] text-gray-500 leading-none mt-0.5">{customerDisplay.phone}</p>
                </div>
              ) : (
                <span className="text-gray-400 text-sm">Select Customer...</span>
              )}
              <div className={`transition-transform duration-200 ${showCustomerSearch ? 'rotate-90' : ''}`}>
                <ChevronRight size={16} />
              </div>
            </button>

            {showCustomerSearch && (
              <div className="absolute top-full left-0 mt-2 w-full bg-white border border-gray-200 shadow-2xl rounded-lg z-[110] p-2 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="relative mb-2">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-300">
                    <Search size={16} />
                  </div>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search name or phone..."
                    className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#3c5a82] text-sm font-medium"
                    value={custSearchTerm}
                    onChange={(e) => setCustSearchTerm(e.target.value)}
                  />
                </div>
                <div className="max-h-[220px] overflow-y-auto space-y-0.5 custom-scrollbar">
                  {(allVisibleCustomers || []).length === 0 && customersFetching ? (
                    <div className="p-4 space-y-3">
                      <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                      <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                    </div>
                  ) : (allVisibleCustomers || []).length === 0 ? (
                    <div className="p-4 text-center text-gray-400 text-sm font-medium">No customers found</div>
                  ) : (
                    (allVisibleCustomers || []).map((c: CustomerSearchOption) => (
                      <div key={c.id} className="group flex items-center gap-1 rounded-lg hover:bg-[#ebf4ff] transition-colors">
                        <button
                          onClick={() => handleCustomerSelect(c)}
                          className="flex-1 min-w-0 px-4 py-2.5 text-left transition-colors"
                        >
                          <p className="text-sm font-bold text-gray-800 truncate">{c.name}</p>
                          <p className="text-[10px] text-gray-400 truncate">{c.id === WALKIN_ID ? 'No permanent record' : c.phone}</p>
                        </button>
                        {can('customers.edit') && (
                          <button
                            title="Edit customer"
                            onClick={() => {
                              setCustomerToEdit(c);
                              setShowCustomerSearch(false);
                            }}
                            className="mr-1.5 shrink-0 p-1.5 rounded-lg text-gray-400 sm:text-gray-300 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:text-[#3c5a82] hover:bg-white transition-all"
                          >
                            <Edit size={16} />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
                {can('customers.create') && (
                  <button
                    onClick={() => {
                      const preFilledPhone = sanitizePhoneInput(custSearchTerm);
                      setCustomerCreateInitialValues(preFilledPhone ? { phone: preFilledPhone } : undefined);
                      setShowCustomerSearch(false);
                      setIsCustomerCreateOpen(true);
                    }}
                    className="w-full mt-2 py-3 text-[10px] font-black uppercase tracking-widest border-t border-gray-50 hover:bg-[#ebf4ff] transition-colors flex items-center justify-center gap-2"
                  >
                    <UserPlus size={14} /> + Add New Customer
                  </button>
                )}
                <button
                  onClick={selectWalkIn}
                  className="w-full mt-1 py-3 text-[10px] font-black uppercase tracking-widest border-t border-gray-50 hover:bg-[#ebf4ff] transition-colors flex items-center justify-center gap-2"
                >
                  <UserRound size={14} /> Walk-in Customer
                </button>
              </div>
            )}
          </div>

          {showPending && (
            <div className="mt-3 rounded-lg border border-gray-100 p-2.5 space-y-1.5 bg-gray-50/50 flex-shrink-0 max-h-40 overflow-y-auto">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Held Sales</p>
              {pendingSales.length === 0 ? (
                <p className="text-xs text-gray-400 px-1">No held sales right now.</p>
              ) : (
                pendingSales.map((order) => (
                  <div key={order.id} className="flex items-center justify-between gap-2 border border-gray-100 rounded-lg px-2.5 py-1.5 bg-white">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-gray-800 truncate">
                        {order.orderNumber} · {order.items.length} lines
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {formatCurrency(order.total)} · {new Date(order.createdAt ?? order.orderDate).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => resumeHold(order)}
                        className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:bg-blue-50 rounded-lg transition"
                      >
                        Resume
                      </button>
                      <IconButton variant="danger" icon={<Trash2 size={13} />} title="Cancel held sale" onClick={() => cancelHold(order)} />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Cart items */}
          <div className="min-h-0 lg:flex-1 lg:overflow-y-auto pr-1 mt-3 space-y-2">
            {cart.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">
                <ShoppingCart size={26} className="mx-auto mb-2 text-gray-300" />
                Tap products to add them to the sale.
              </div>
            ) : (
              cart.map((line) => {
                const img = productImage(line.productId);
                const lineTot = round2(line.rate * line.quantity);
                return (
                  <div key={line.key} className="flex items-center gap-2.5 border border-gray-100 rounded-lg p-2">
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
                      {img ? (
                        <img
                          src={img}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <PackageOpen size={16} className="text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-800 truncate">{line.productName}</div>
                      <div className="text-[11px] text-gray-500 font-medium">
                        {formatCurrency(line.rate)}
                        {line.rate < line.originalRate && <span className="text-gray-400 line-through ml-1">{formatCurrency(line.originalRate)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                        onClick={() => updateLineQuantity(line.key, -1)}
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-7 text-center text-xs font-bold text-gray-800">{line.quantity}</span>
                      <button
                        type="button"
                        className="w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                        onClick={() => updateLineQuantity(line.key, 1)}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <div className="w-14 text-right text-xs font-bold text-gray-900">{formatCurrency(lineTot)}</div>
                    <IconButton variant="neutral" icon={<X size={13} />} title="Remove item" onClick={() => removeLine(line.key)} />
                  </div>
                );
              })
            )}
          </div>

          {/* Summary & checkout */}
          <div className="mt-3 rounded-xl bg-gray-100/70 p-3 space-y-2 flex-shrink-0">
            {moneyRow('Subtotal', subtotal)}

            <div className="rounded-lg border border-gray-100 bg-white/70 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-wider shrink-0">Discount</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setDiscountMode('fixed')}
                    className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg transition ${
                      discountMode === 'fixed' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    Fixed
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountMode('percent')}
                    className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg transition ${
                      discountMode === 'percent' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    %
                  </button>
                  <Input
                    type="number"
                    min="0"
                    step={discountMode === 'fixed' ? '0.01' : '1'}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className="!w-20 !py-1 text-right"
                  />
                </div>
              </div>
              {discountAmount > 0 && (
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Discount amount</span>
                  <span className="font-semibold text-emerald-600">−{formatCurrency(discountAmount)}</span>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-100 bg-white/70 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-wider shrink-0">Tax (VAT)</span>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={vatRate}
                    onChange={(e) => setVatRate(e.target.value)}
                    className="!w-20 !py-1 text-right"
                  />
                  <span className="text-xs text-gray-400 shrink-0">%</span>
                </div>
              </div>
              {vatAmount > 0 && (
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Tax amount</span>
                  <span className="font-semibold text-gray-700">{formatCurrency(vatAmount)}</span>
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 pt-2">{moneyRow('Total', payable, true)}</div>
          </div>

          <div className="mt-3 flex gap-2 flex-shrink-0">
            <Button variant="secondary" size="md" icon={<Pause size={15} />} onClick={() => void holdSale()} disabled={submitting}>
              Hold
            </Button>
            <Button
              className="flex-1 !text-base"
              icon={<ArrowRight size={17} />}
              onClick={openCheckout}
              disabled={submitting}
              loading={submitting}
            >
              Continue
            </Button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400 flex-shrink-0">
            <span>{itemCount} item(s)</span>
            {customer && <span className="truncate max-w-[60%]">{customerDisplay?.name}</span>}
          </div>
        </Card>
      </div>

      {/* ===== Checkout modal ===== */}
      <Modal
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        title="Checkout"
        size="md"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="secondary" onClick={() => setCheckoutOpen(false)}>
              Cancel
            </Button>
            <Button icon={<ShoppingCart size={16} />} loading={submitting} onClick={() => void completeSale()}>
              Complete Sale
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-gray-100/70 px-3 py-2 flex items-center justify-between">
            <span className="text-sm text-gray-600">Total payable</span>
            <span className="text-lg font-bold text-gray-900">{formatCurrency(payable)}</span>
          </div>

          <div className="rounded-lg border border-gray-100 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-gray-600 uppercase tracking-wider shrink-0">Split Payment</p>
              <span className="text-xs font-semibold text-gray-700">{formatCurrency(allocated)} of {formatCurrency(payable)}</span>
            </div>
            <div className={`h-1.5 rounded-full overflow-hidden transition-colors ${allocPct >= 100 ? 'bg-emerald-100' : 'bg-gray-100'}`}>
              <div className={`h-full transition-all duration-300 ${allocPct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${allocPct}%` }} />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {paymentMethods.map((method) => {
                const active = activeMethods[method.id] !== false;
                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => togglePaymentMethod(method.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition ${
                      active
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    {active ? <Check size={12} /> : <span className="w-3" />}
                    {method.label}
                  </button>
                );
              })}
            </div>

            {activePaymentMethods.length === 0 ? (
              <p className="text-xs font-medium text-amber-600">Turn on at least one payment method to continue.</p>
            ) : (
              <div className="space-y-2">
                {activePaymentMethods.map((method) => (
                  <div key={method.id} className="flex items-center gap-2">
                    <span className="w-24 text-xs font-medium text-gray-700 truncate shrink-0">{method.label}</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={allocations[method.id] ?? ''}
                      placeholder="0.00"
                      onChange={(e) => setAllocations((a) => ({ ...a, [method.id]: e.target.value }))}
                      className="!py-1.5 text-right flex-1"
                    />
                    <button
                      type="button"
                      title="Allocate remaining balance"
                      className="shrink-0 px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:bg-blue-50 rounded-lg transition"
                      onClick={() => setAllocations((a) => ({ ...a, [method.id]: balance > 0 ? String(round2(balance)) : '' }))}
                    >
                      Fill
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-1 border-t border-gray-100 text-xs">
              <span className="text-gray-500">Balance to allocate</span>
              <span className={balance === 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-amber-600'}>
                {balance === 0 ? 'Fully allocated' : formatCurrency(balance)}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-gray-100 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-gray-600 uppercase tracking-wider shrink-0">Amount Received</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                className="!w-40 !py-1.5 text-right"
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Change to return</span>
              <span className={`font-semibold ${change > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>{formatCurrency(change)}</span>
            </div>
          </div>

          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note on receipt (optional)" />
        </div>
      </Modal>

      <Modal
        isOpen={receipt !== null}
        onClose={() => setReceipt(null)}
        title={`Receipt ${receipt?.orderNumber ?? ''}`}
        size="md"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="secondary" onClick={() => setReceipt(null)}>
              Close
            </Button>
            <Button icon={<Printer size={16} />} onClick={() => receipt && handlePrintOrder(receipt.id, navigate)}>
              Print
            </Button>
          </div>
        }
      >
        {receipt && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>{new Date(receipt.orderDate).toLocaleString()}</span>
              <Badge status={receipt.status} />
            </div>
            {customer && (
              <div className="text-sm">
                <span className="text-gray-500">Customer: </span>
                <span className="font-semibold text-gray-800">{customerDisplay?.name}</span>
              </div>
            )}
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {receipt.items.map((item, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">
                    {item.quantity} × {item.productName}
                  </span>
                  <span className="font-medium text-gray-900">{formatCurrency(item.amount)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 pt-2 space-y-1">
              {moneyRow('Subtotal', receipt.subtotal)}
              {receipt.discount > 0 && moneyRow('Discount', -receipt.discount, false, 'text-emerald-600')}
              {receipt.vatAmount > 0 && moneyRow(`Tax (${receipt.vatRate}%)`, receipt.vatAmount)}
              {moneyRow('Total', receipt.total, true)}
              {receipt.tenders.map((t) => moneyRow(`${t.methodName} received`, t.amount))}
              {receipt.change > 0 && moneyRow('Change to return', -receipt.change, false, 'text-emerald-600')}
            </div>
            {receipt.notes && <p className="text-xs text-gray-500 italic">{receipt.notes}</p>}
          </div>
        )}
      </Modal>

      {isCustomerCreateOpen && (
        <CustomerCreateModal
          isOpen
          onClose={() => setIsCustomerCreateOpen(false)}
          initialValues={customerCreateInitialValues}
          onCreated={handleCustomerSelect}
        />
      )}
      {customerToEdit && (
        <CustomerCreateModal
          isOpen
          onClose={() => setCustomerToEdit(null)}
          editingCustomer={customerToEdit}
          onUpdated={(updated) => {
            handleCustomerSelect(updated);
          }}
        />
      )}
    </div>
  );
}