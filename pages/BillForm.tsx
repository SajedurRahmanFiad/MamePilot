
import React, { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { db } from '../db';
import { BillStatus, OrderItem, Vendor } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button, NumericInput, VendorCreateModal } from '../components';
import { theme } from '../theme';
import { useBill, useSystemDefaults, useVendor, useBeSmartSettings } from '../src/hooks/useQueries';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { fetchProductsMini, fetchProductsSearch, fetchVendorsPage, lookupVendorBySmartInput } from '../src/services/supabaseQueries';
import { useCreateBill, useUpdateBill, useCreateVendor } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { formatDateTimeParts, getTodayDate, sanitizePhoneInput } from '../utils';
import { getNextBillNumber } from '../src/services/supabaseQueries';

const BillForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = db.currentUser;
  const { can, canAccessRecord } = useRolePermissions();
  const isEdit = Boolean(id);

  // Be Smart: bill vendor selection
  const { capabilities } = useCapabilities(Boolean(user));
  const hasBeSmart = Boolean(capabilities.be_smart);
  const { data: beSmartSettings, isPending: smartSettingsLoading } = useBeSmartSettings(hasBeSmart);
  const smartVendorSelection = hasBeSmart && Boolean(beSmartSettings?.smartBillVendorSelection);
  const [billSmartInput, setBillSmartInput] = useState('');
  const [smartLookupUsed, setSmartLookupUsed] = useState(false);
  const [smartLookupLoading, setSmartLookupLoading] = useState(false);
  const [smartLookupFound, setSmartLookupFound] = useState<boolean | null>(null);
  const createVendorMutation = useCreateVendor();

  // Safety check
  if (!user) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Not Authenticated</h2>
        <p className="text-gray-500 mb-6">Please log in first.</p>
        <Button onClick={() => navigate('/login')} variant="primary">Back to Login</Button>
      </div>
    );
  }

  // Query data
  const queryClient = useQueryClient();
  const { data: existingBillData, isPending: billLoading, error: billError } = useBill(id);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  // Cumulative map of all products seen across mini, search, and full caches.
  // Ensures addItem can find products even after the search filter changes the visible list.
  const allProductsRef = React.useRef<Map<string, any>>(new Map());
  const { data: systemDefaults } = useSystemDefaults();
  const isMultiSelectMode = (systemDefaults?.productSelectionMode ?? 'simple') === 'multi';

  // Lightweight fetch used only when the product search dropdown opens.
  const { data: productsMini = [], isFetching: productsMiniLoading } = useQuery({
    queryKey: ['productsMini'],
    queryFn: fetchProductsMini,
    staleTime: 5 * 60 * 1000,
    enabled: false,
    refetchOnWindowFocus: false,
  });

  // When user opens the product search, enable fetching lightweight list if no full cache exists.
  React.useEffect(() => {
    if (!showProductSearch) return;
    const full = queryClient.getQueryData<any[]>(['products']);
    if (!full || full.length === 0) {
      queryClient.fetchQuery({ queryKey: ['productsMini'], queryFn: fetchProductsMini }).catch(() => {});
    }
  }, [showProductSearch, queryClient]);

  // Debounced search term to avoid firing on every keystroke
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Query server for matching products when user types; otherwise use mini list
  const { data: productsSearch = [], isFetching: productsSearchLoading } = useQuery({
    queryKey: ['productsSearch', debouncedSearch],
    queryFn: () => fetchProductsSearch(debouncedSearch, 100),
    enabled: showProductSearch && !!debouncedSearch,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Prefer server-side search results when the user is searching.
  // Otherwise, fall back to the full products cache or a lightweight mini list.
  const fullProducts = queryClient.getQueryData<any[]>(['products']);
  const products = debouncedSearch
    ? productsSearch
    : ((fullProducts && fullProducts.length > 0) ? fullProducts : (productsMini || []));

  // Accumulate all seen products into the ref so addItem can find them after search changes
  React.useEffect(() => {
    for (const p of products) {
      if (p?.id) allProductsRef.current.set(p.id, p);
    }
  }, [products]);

  // Mutations
  const createMutation = useCreateBill();
  const updateMutation = useUpdateBill();
  const toast = useToastNotifications();

  // Form state
  const [vendorId, setVendorId] = useState('');
  const [isVendorCreateOpen, setIsVendorCreateOpen] = useState(false);
  const [vendorCreateInitialValues, setVendorCreateInitialValues] = useState<Partial<Pick<Vendor, 'name' | 'phone' | 'address'>>>();
  const [vendorToEdit, setVendorToEdit] = useState<any>(null);
  const [billDate, setBillDate] = useState(getTodayDate());
  const [billNumber, setBillNumber] = useState('Generating...');
  const [billNumberLoading, setBillNumberLoading] = useState(false);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [notes, setNotes] = useState('');
  

  const [showVendorSearch, setShowVendorSearch] = useState(false);
  const [vendorSearchTerm, setVendorSearchTerm] = useState('');
  const [debouncedVendorSearch, setDebouncedVendorSearch] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedVendorSearch(vendorSearchTerm.trim()), 300);
    return () => clearTimeout(t);
  }, [vendorSearchTerm]);

  // Vendors: fetch just the visible search window instead of the full list.
  const vendorPageSize = 20;
  const { data: vendorsPage, isFetching: vendorsFetching } = useQuery({
    queryKey: ['vendors', 1, vendorPageSize, debouncedVendorSearch],
    queryFn: () => fetchVendorsPage(1, vendorPageSize, debouncedVendorSearch),
    enabled: showVendorSearch,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const { data: selectedVendorRecord } = useVendor(vendorId || undefined);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initializedRef = React.useRef(false);

  // Initialize form with existing bill data when loaded
  React.useEffect(() => {
    if (existingBillData && !initializedRef.current) {
      if (isEdit && !canAccessRecord(existingBillData.createdBy, 'bills.editOwn', 'bills.editAny')) {
        toast.warning('You do not have permission to edit this bill.');
        navigate('/bills');
        return;
      }

      setVendorId(existingBillData.vendorId);
      setBillDate(existingBillData.billDate);
      setBillNumber(existingBillData.billNumber);
      setItems(existingBillData.items);
      setDiscount(existingBillData.discount);
      setShipping(existingBillData.shipping);
      setNotes(existingBillData.notes || '');
      initializedRef.current = true;
      return;
    }

    if (!isEdit && !initializedRef.current) {
      setBillNumberLoading(true);
      getNextBillNumber()
        .then((nextNumber) => {
          setBillNumber(nextNumber);
          initializedRef.current = true;
        })
        .catch((err) => {
          console.error('Failed to fetch next bill number:', err);
          setBillNumber('ERROR');
          toast.error('Failed to generate bill number. Please refresh the page.');
        })
        .finally(() => {
          setBillNumberLoading(false);
        });
    }
  }, [canAccessRecord, existingBillData, isEdit, navigate, toast]);

  React.useEffect(() => {
    initializedRef.current = false;
  }, [id]);

  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const totalBeforeDiscount = Math.max(0, subtotal + shipping);
  const total = Math.max(0, totalBeforeDiscount - discount);

  const handleDiscountChange = (value: number) => {
    setDiscount(Math.min(totalBeforeDiscount, Math.max(0, value)));
  };

  const handleTotalChange = (value: number) => {
    const nextTotal = Math.min(totalBeforeDiscount, Math.max(0, value));
    setDiscount(Math.max(0, totalBeforeDiscount - nextTotal));
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const addItem = (productId: string) => {
    const product = allProductsRef.current.get(productId) ?? products.find(p => p.id === productId);
    if (!product) return;

    const isBatch = product.itemType === 'batch';

    const newItem: OrderItem = {
      productId: product.id,
      productName: isBatch ? `[Batch] ${product.name}` : product.name,
      rate: product.purchasePrice,
      quantity: 1,
      amount: product.purchasePrice
    };
    setItems(prev => [...prev, newItem]);
    if (!isMultiSelectMode) {
      setShowProductSearch(false);
      setSearchTerm('');
    }
  };

  const addSelectedItems = () => {
    selectedProductIds.forEach(id => addItem(id));
    setSelectedProductIds(new Set());
    setShowProductSearch(false);
    setSearchTerm('');
  };

  const updateQuantity = (index: number, qty: number) => {
    const newItems = [...items];
    newItems[index].quantity = Math.max(1, qty);
    newItems[index].amount = newItems[index].rate * newItems[index].quantity;
    setItems(newItems);
  };

  const updateRate = (index: number, rate: number) => {
    const newItems = [...items];
    newItems[index].rate = Math.max(0, rate);
    newItems[index].amount = newItems[index].rate * newItems[index].quantity;
    setItems(newItems);
  };

  const updateAmount = (index: number, amount: number) => {
    const newItems = [...items];
    newItems[index].amount = Math.max(0, amount);
    newItems[index].rate = newItems[index].quantity > 0 ? newItems[index].amount / newItems[index].quantity : 0;
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleSmartLookup = async () => {
    if (!billSmartInput.trim()) return;
    setSmartLookupLoading(true);
    try {
      const result = await lookupVendorBySmartInput(billSmartInput.trim());
      if (result.found && result.vendor) {
        setVendorId(result.vendor.id);
      }
      setSmartLookupUsed(true);
      setSmartLookupFound(result.found);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to look up vendor.';
      toast.error(msg);
    } finally {
      setSmartLookupLoading(false);
    }
  };

  const handleSave = async () => {
    // When smart vendor selection is enabled, resolve the smart input to a vendor first
    let resolvedVendorId = vendorId;
    if (smartVendorSelection && billSmartInput.trim()) {
      if (items.length === 0 || !billNumber || billNumber === 'Generating...' || billNumber === 'ERROR') {
        setError(!items.length ? 'Please add at least one product.' : 'Bill number is still being generated. Please wait a moment.');
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const created = await createVendorMutation.mutateAsync({
          name: '', phone: '', address: '', totalPurchases: 0, dueAmount: 0,
          smartInput: billSmartInput.trim(),
        });
        resolvedVendorId = created.id;
      } catch (err: any) {
        setSaving(false);
        const debug = err?.raw?.debug;
        let msg = err instanceof Error ? err.message : 'Failed to resolve vendor details.';
        if (debug) {
          if (debug.llm_error) msg += '\nLLM: ' + debug.llm_error;
          if (debug.raw_response) msg += '\nResponse: ' + debug.raw_response;
          if (debug.regex_phone) msg += '\nRegex phone: ' + debug.regex_phone;
        }
        setError(msg);
        toast.error(msg);
        return;
      }
    }

    if (!resolvedVendorId || items.length === 0) {
      setError(smartVendorSelection ? 'Please enter vendor details and add at least one product.' : 'Please select a vendor and add at least one product.');
      return;
    }

    if (!user?.id) {
      setError('User session expired. Please log in again.');
      return;
    }
    const maxDiscount = subtotal + shipping;
    if (discount < 0 || discount > maxDiscount) {
      setError(`Discount must be between ${formatCurrency(0)} and ${formatCurrency(maxDiscount)}.`);
      return;
    }
    if (shipping < 0) {
      setError('Shipping charge cannot be negative.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
      const total = Math.max(0, subtotal - discount + shipping);
      const { date: dateStr, time: timeStr } = formatDateTimeParts(new Date());

      const billData = {
        billNumber,
        billDate,
        vendorId: resolvedVendorId,
        createdBy: user.id,
        status: isEdit && existingBillData ? existingBillData.status : BillStatus.ON_HOLD,
        items,
        subtotal,
        discount,
        shipping,
        total,
        notes,
        paidAmount: isEdit && existingBillData ? existingBillData.paidAmount : 0,
        history: isEdit && existingBillData ? existingBillData.history : {
          created: `Created by ${user.name} on ${dateStr}, at ${timeStr}`
        }
      };

      if (isEdit) {
        await updateMutation.mutateAsync({ id: id!, updates: billData });
        toast.success('Bill updated successfully');
        setSaving(false);
        navigate('/bills');
      } else {
        createMutation.mutateAsync(billData as any).then(
          (createdBill) => {
            setSaving(false);
            toast.success('Bill created successfully');
            navigate(`/bills/${createdBill.id}`);
          },
          (err) => {
            setSaving(false);
            const errorMsg = err instanceof Error ? err.message : 'Failed to save bill';
            setError(errorMsg);
            toast.error(errorMsg);
          }
        );
      }
    } catch (err) {
      console.error('Failed to save bill:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to save bill';
      setError(errorMsg);
      toast.error(errorMsg);
      setSaving(false);
    }
  };

  const visibleVendors = React.useMemo(() => {
    return vendorsPage?.data || [];
  }, [vendorsPage?.data]);
  const selectedVendor =
    selectedVendorRecord ||
    visibleVendors.find((vendor) => vendor.id === vendorId) ||
    (existingBillData?.vendorId === vendorId
      ? {
          id: existingBillData.vendorId,
          name: existingBillData.vendorName || '',
          phone: existingBillData.vendorPhone || '',
          address: existingBillData.vendorAddress || '',
          totalPurchases: 0,
          dueAmount: 0,
        }
      : undefined);

  // If redirected back with a selectedVendorId in the URL, apply it and clean the URL
  const location = useLocation();
  React.useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      const selected = params.get('selectedVendorId');
      if (selected) {
        // If vendor exists in the loaded list, set it immediately; otherwise still set id
        setVendorId(selected);
        setShowVendorSearch(false);

        // Remove the query param from the URL to avoid repeated selection
        params.delete('selectedVendorId');
        const newSearch = params.toString();
        const newPath = `${location.pathname}${newSearch ? `?${newSearch}` : ''}`;
        navigate(newPath, { replace: true });
      }
    } catch (e) {
      // ignore malformed URL
    }
  }, [location.search, visibleVendors, navigate, location.pathname]);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Bill' : 'New Purchase Bill'}</h2>
        <button onClick={() => navigate('/bills')} className="text-gray-500 hover:text-gray-700 font-medium text-sm px-4 py-2 border border-gray-200 rounded-lg bg-white transition-all">
          Cancel
        </button>
      </div>

      <div className="bg-white p-6 rounded-lg border border-gray-100 shadow-sm space-y-6">
        {smartVendorSelection ? (
          <div className="grid grid-cols-1 gap-6">
            <div className="space-y-1 relative">
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Vendor Details</label>
              </div>
              <textarea
                autoFocus
                className="min-h-[120px] w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium leading-7 outline-none transition-all focus:border-[#3c5a82] focus:bg-white"
                value={billSmartInput}
                onChange={(e) => {
                  setBillSmartInput(e.target.value);
                  if (smartLookupUsed) {
                    setSmartLookupUsed(false);
                    setSmartLookupFound(null);
                    setVendorId('');
                  }
                }}
                placeholder={'Paste the vendor details exactly as the vendor sent it.\n\nExample:\nRahim Traders\n01712345678\nHouse 12, Road 4, Mirpur, Dhaka'}
              />
              <div className="flex items-center gap-2 mt-1">
                {!smartLookupUsed ? (
                  <button
                    type="button"
                    onClick={handleSmartLookup}
                    disabled={smartLookupLoading || !billSmartInput.trim()}
                    className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {smartLookupLoading ? 'Looking up...' : 'Lookup'}
                  </button>
                ) : smartLookupFound ? (
                  <span className="text-[11px] font-bold text-orange-500">Existing vendor</span>
                ) : (
                  <span className="text-[11px] font-bold text-green-600">New vendor</span>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Bill Date</label>
                <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-[#3c5a82] focus:bg-white transition-all cursor-pointer font-bold text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Bill Number</label>
                <input
                  type="text"
                  readOnly
                  value={billNumber}
                  placeholder="Generating..."
                  className={`w-full px-4 py-3 bg-gray-100 border border-gray-100 rounded-xl font-mono text-sm font-bold ${billNumber === 'ERROR' ? 'text-red-600' : ''}`}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
            <div className="space-y-1 relative md:col-span-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Select Vendor</label>
              <div className="relative">
                <button 
                  onClick={() => setShowVendorSearch(!showVendorSearch)}
                  className="w-full text-left px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl hover:bg-white focus:ring-2 focus:ring-[#3c5a82] transition-all flex justify-between items-center group"
                >
                  {selectedVendor ? (
                    <div className="flex-1 overflow-hidden">
                      <span className="font-bold block text-sm text-gray-900">{selectedVendor.name}</span>
                      <p className="text-[10px] text-gray-500 leading-none mt-0.5">{selectedVendor.phone}</p>
                      <p className="text-[10px] text-gray-500 italic truncate mt-1">{selectedVendor.address}</p>
                    </div>
                  ) : <span className="text-gray-400 text-sm">Select Vendor...</span>}
                  <div className={`transition-transform duration-200 ${showVendorSearch ? 'rotate-90' : ''}`}>
                     {ICONS.ChevronRight}
                  </div>
                </button>
                
                {showVendorSearch && (
                  <div className="absolute top-full left-0 mt-2 w-full max-w-xs bg-white border border-gray-200 shadow-2xl rounded-lg z-[110] p-2 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="relative mb-2">
                      <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-300">
                        {ICONS.Search}
                      </div>
                      <input autoFocus type="text" placeholder="Search business or phone..." className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#3c5a82] text-sm font-medium" value={vendorSearchTerm} onChange={(e) => setVendorSearchTerm(e.target.value)} />
                    </div>
                    <div className="max-h-[220px] overflow-y-auto space-y-0.5 custom-scrollbar">
                      {(visibleVendors || []).length === 0 && vendorsFetching ? (
                        <div className="p-4 space-y-3">
                          <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                          <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                        </div>
                      ) : (visibleVendors || []).length === 0 ? (
                        <div className="p-4 text-center text-gray-400 text-sm font-medium">No vendors found</div>
                      ) : (
                        (visibleVendors || []).map((v: any) => (
                          <div key={v.id} className="group flex items-center gap-1 rounded-lg hover:bg-[#e6f0ff] transition-colors">
                            <button onClick={() => { setVendorId(v.id); setShowVendorSearch(false); setVendorSearchTerm(''); }} className="flex-1 min-w-0 px-4 py-2.5 text-left transition-colors">
                              <p className="text-sm font-bold text-gray-800 group-hover:text-sky-700 truncate">{v.name}</p>
                              <p className="text-[10px] text-gray-400 group-hover:text-sky-600/60 truncate">{v.phone}</p>
                            </button>
                            {can('vendors.edit') && (
                              <button
                                title="Edit vendor"
                                onClick={() => {
                                  setVendorToEdit(v);
                                  setShowVendorSearch(false);
                                }}
                                className="mr-1.5 shrink-0 p-1.5 rounded-lg text-gray-400 sm:text-gray-300 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:text-[#3c5a82] hover:bg-white transition-all"
                              >
                                {ICONS.Edit}
                              </button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                    {can('vendors.create') && (
                      <Button onClick={() => {
                        const preFilledPhone = sanitizePhoneInput(vendorSearchTerm);
                        setVendorCreateInitialValues(preFilledPhone ? { phone: preFilledPhone } : undefined);
                        setShowVendorSearch(false);
                        setIsVendorCreateOpen(true);
                      }} variant="secondary" size="sm" className="w-full mt-2 py-3 text-[10px] font-black uppercase tracking-widest border-t border-gray-50 hover:bg-[#ebf4ff] transition-colors" icon={ICONS.Plus}>Add New Vendor</Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Bill Date</label>
              <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-[#3c5a82] focus:bg-white transition-all cursor-pointer font-bold text-sm" />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Bill Number</label>
              <input
                type="text"
                readOnly
                value={billNumber}
                placeholder="Generating..."
                className={`w-full px-4 py-3 bg-gray-100 border border-gray-100 rounded-xl font-mono text-sm font-bold ${billNumber === 'ERROR' ? 'text-red-600' : ''}`}
              />
            </div>
          </div>
        )}

        <div className="border border-gray-100 rounded-lg overflow-visible bg-white">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Product Item</th>
                <th className="px-4 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Cost Rate</th>
                <th className="px-4 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Qty</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Amount</th>
                <th className="px-4 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item, idx) => (
                <tr key={idx} className="group hover:bg-gray-50/50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      {(allProductsRef.current.get(item.productId) ?? products.find(p => p.id === item.productId))?.image && (
                        <img src={(allProductsRef.current.get(item.productId) ?? products.find(p => p.id === item.productId))?.image} className="w-12 h-12 rounded-full object-cover border border-gray-100 shadow-sm" />
                      )}
                      <span className="font-bold text-gray-800 text-sm">{item.productName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <NumericInput value={item.rate} onChange={(value) => updateRate(idx, value)} className="w-24 text-center py-2 border border-gray-100 rounded-xl focus:ring-2 focus:ring-[#3c5a82]" allowDecimals={true} decimalPlaces={2} />
                  </td>
                  <td className="px-4 py-4 text-center">
                    <NumericInput value={item.quantity} onChange={(value) => updateQuantity(idx, value)} className="w-16 text-center py-2 border border-gray-100 rounded-xl focus:ring-2 focus:ring-[#3c5a82]" allowDecimals={false} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <NumericInput value={item.amount} onChange={(value) => updateAmount(idx, value)} className="w-28 text-right py-2 border border-gray-100 rounded-xl focus:ring-2 focus:ring-[#3c5a82] font-black" allowDecimals={true} decimalPlaces={2} />
                  </td>
                  <td className="px-4 py-4 text-right">
                    <button onClick={() => removeItem(idx)} className="p-2 text-red-200 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                      {ICONS.Delete}
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={5} className="px-6 py-5 relative">
                  <div className="relative">
                    <Button onClick={() => { setShowProductSearch(prev => !prev); setSelectedProductIds(new Set()); setSearchTerm(''); }} variant="secondary" size="sm" icon={ICONS.Plus} className={`border-2 border-dashed ${theme.colors.primary.border}`}>Add an item</Button>
                    {showProductSearch && (
                      <div className="absolute top-full left-0 mt-3 w-full max-w-md bg-white border border-gray-200 shadow-2xl rounded-lg z-[100] p-2 overflow-hidden animate-in slide-in-from-top-2 duration-200">
                        <div className="relative mb-2">
                          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-300">
                            {ICONS.Search}
                          </div>
                          <input autoFocus type="text" placeholder="Search product..." className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#3c5a82] text-sm font-medium" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                        <div className="max-h-[260px] overflow-y-auto space-y-0.5 custom-scrollbar">
                          {products.length === 0 && (productsMiniLoading || productsSearchLoading) ? (
                            <div className="p-4 space-y-3">
                              <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                              <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                              <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                            </div>
                          ) : products.length === 0 ? (
                            <div className="p-4 text-center text-gray-400 text-sm font-medium">No products found</div>
                          ) : (
                            products.map(p => (
                              <button
                                key={p.id}
                                onClick={() => isMultiSelectMode ? toggleProductSelection(p.id) : addItem(p.id)}
                                className={`flex items-center gap-4 w-full px-4 py-3 text-left rounded-xl group transition-all ${
                                  isMultiSelectMode && selectedProductIds.has(p.id) ? 'bg-[#dbeafe] ring-2 ring-[#3c5a82]' : 'hover:bg-[#e6f0ff]'
                                }`}
                              >
                                {isMultiSelectMode && (
                                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all shrink-0 ${
                                    selectedProductIds.has(p.id) ? 'bg-[#3c5a82] border-[#3c5a82]' : 'border-gray-300'
                                  }`}>
                                    {selectedProductIds.has(p.id) && (
                                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                  </div>
                                )}
                                {(allProductsRef.current.get(p.id) ?? p).image && (
                                  <img src={(allProductsRef.current.get(p.id) ?? p).image} className="w-10 h-10 rounded-full object-cover border border-gray-100 shadow-sm" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-gray-800 group-hover:text-sky-700 truncate">{p.name}</p>
                                  <p className="text-[10px] font-bold text-sky-600/60 uppercase tracking-widest">Cost: {formatCurrency(p.purchasePrice)}</p>
                                  {p.itemType === 'batch' ? (
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Population: {p.population ?? 0} • Age: {p.averageAgeDays ?? 0} days</p>
                                  ) : (
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Current Stock: {p.stock ?? 0}</p>
                                  )}
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                        {isMultiSelectMode && selectedProductIds.size > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-100 px-1">
                            <button
                              onClick={addSelectedItems}
                              className={`w-full py-2.5 ${theme.colors.primary[600]} text-white font-bold text-sm rounded-xl hover:${theme.colors.primary[700]} transition-all flex items-center justify-center gap-2`}
                            >
                              {ICONS.Check} Add {selectedProductIds.size} item{selectedProductIds.size > 1 ? 's' : ''}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-col md:flex-row justify-between gap-12 pt-6">
          <div className="flex-1 space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Purchase Memo</label>
            <textarea placeholder="Bill details, vendor instructions, or delivery notes..." value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-lg h-32 focus:ring-2 focus:ring-[#3c5a82] focus:bg-white outline-none font-medium text-sm transition-all" />
          </div>
          <div className="w-full md:w-96 space-y-4 bg-gray-50/50 p-8 rounded-lg border border-gray-100">
            <div className="flex justify-between items-center text-gray-500 text-[12px] font-bold uppercase tracking-widest">
              <span>Subtotal</span>
              <span className="text-gray-900 font-black">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between items-center text-gray-500 text-[12px] font-bold uppercase tracking-widest">
              <span>Discount</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-black">৳</span>
                <NumericInput value={discount} onChange={handleDiscountChange} className="w-20 text-right py-1.5 border border-gray-100 rounded-lg focus:ring-2 focus:ring-[#3c5a82] text-gray-900 bg-white" allowDecimals={true} decimalPlaces={2} />
              </div>
            </div>
            <div className="flex justify-between items-center text-gray-500 text-[12px] font-bold uppercase tracking-widest">
              <span>Shipping</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-black">৳</span>
                <NumericInput value={shipping} onChange={(value) => setShipping(value)} className="w-20 text-right py-1.5 border border-gray-100 rounded-lg focus:ring-2 focus:ring-[#3c5a82] text-gray-900 bg-white" allowDecimals={true} decimalPlaces={2} />
              </div>
            </div>
            <div className="pt-6 border-t-4 border-[#c7dff5] flex justify-between items-center">
              <span className="text-sm font-black text-gray-900 uppercase tracking-tighter">Total</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#3c5a82] font-black">৳</span>
                <NumericInput value={total} onChange={handleTotalChange} className="w-24 text-right py-1.5 border border-[#c7dff5] rounded-lg focus:ring-2 focus:ring-[#3c5a82] text-[#3c5a82] bg-white font-black" allowDecimals={true} decimalPlaces={2} aria-label="Bill total" />
              </div>
            </div>
            <Button 
              onClick={handleSave}
              variant="primary"
              size="lg"
              className="w-full mt-4"
              loading={saving}
              disabled={saving}
            >
              {isEdit ? 'Update Purchase Bill' : 'Create Purchase Bill'}
            </Button>
          </div>
        </div>
      </div>
      {isVendorCreateOpen && (
        <VendorCreateModal
          isOpen
          onClose={() => setIsVendorCreateOpen(false)}
          initialValues={vendorCreateInitialValues}
          onCreated={(vendor) => {
            setVendorId(vendor.id);
            setShowVendorSearch(false);
            setVendorSearchTerm('');
          }}
        />
      )}
      {vendorToEdit && (
        <VendorCreateModal
          isOpen
          onClose={() => setVendorToEdit(null)}
          editingVendor={vendorToEdit}
          onUpdated={(updated) => {
            setVendorId(updated.id);
            setVendorToEdit(null);
          }}
        />
      )}
    </div>
  );
};

export default BillForm;



