
import React, { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { db } from '../db';
import { BillStatus, OrderItem } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button } from '../components';
import { theme } from '../theme';
import { useBill, useVendor } from '../src/hooks/useQueries';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { fetchProductsMini, fetchProductsSearch, fetchVendorsPage } from '../src/services/supabaseQueries';
import { useCreateBill, useUpdateBill } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { getTodayDate, sanitizePhoneInput } from '../utils';

const BillForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = db.currentUser;
  const { canAccessRecord } = useRolePermissions();
  const isEdit = Boolean(id);

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

  // Prefer full products cache if present, otherwise use search results when typing, or mini list when empty.
  const fullProducts = queryClient.getQueryData<any[]>(['products']);
  const products = (fullProducts && fullProducts.length > 0)
    ? fullProducts
    : (debouncedSearch ? productsSearch : (productsMini || []));
  
  // Mutations
  const createMutation = useCreateBill();
  const updateMutation = useUpdateBill();
  const toast = useToastNotifications();

  // Form state
  const [vendorId, setVendorId] = useState('');
  const [billDate, setBillDate] = useState(getTodayDate());
  const [billNumber, setBillNumber] = useState('');
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

  // Initialize form with existing bill data when loaded
  React.useEffect(() => {
    if (existingBillData) {
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
    } else if (!isEdit) {
      setBillNumber(`PUR-${Math.floor(1000 + Math.random() * 9000)}`);
    }
  }, [canAccessRecord, existingBillData, isEdit, navigate, toast]);

  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const total = subtotal - discount + shipping;

  const addItem = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const newItem: OrderItem = {
      productId: product.id,
      productName: product.name,
      rate: product.purchasePrice,
      quantity: 1,
      amount: product.purchasePrice
    };
    setItems([...items, newItem]);
    setShowProductSearch(false);
    setSearchTerm('');
  };

  const updateQuantity = (index: number, qty: number) => {
    const newItems = [...items];
    newItems[index].quantity = Math.max(1, qty);
    newItems[index].amount = newItems[index].rate * newItems[index].quantity;
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!vendorId || items.length === 0) {
      setError('Please select a vendor and add at least one product.');
      return;
    }

    if (!user?.id) {
      setError('User session expired. Please log in again.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
      const total = subtotal - discount + shipping;
      const dateStr = new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' });
      const timeStr = new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' });

      const billData = {
        billNumber,
        billDate,
        vendorId,
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-1 relative md:col-span-1">
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
                    <p className="text-[10px] ${theme.colors.secondary[600]} italic truncate mt-1">{selectedVendor.address}</p>
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
                    {vendorsFetching ? (
                      <div className="p-4 space-y-3">
                        <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                        <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                      </div>
                    ) : (visibleVendors || []).length === 0 ? (
                      <div className="p-4 text-center text-gray-400 text-sm font-medium">No vendors found</div>
                    ) : (
                      (visibleVendors || []).map((v: any) => (
                        <button key={v.id} onClick={() => { setVendorId(v.id); setShowVendorSearch(false); setVendorSearchTerm(''); }} className="w-full px-4 py-2.5 text-left hover:bg-[#e6f0ff] rounded-lg group transition-colors">
                          <p className="text-sm font-bold text-gray-800 group-hover:${theme.colors.secondary[700]}">{v.name}</p>
                          <p className="text-[10px] text-gray-400 group-hover:${theme.colors.secondary[600]}/60">{v.phone}</p>
                        </button>
                      ))
                    )}
                  </div>
                  <Button onClick={() => {
                    const preFilledPhone = sanitizePhoneInput(vendorSearchTerm);
                    setShowVendorSearch(false);
                    navigate('/vendors/new', {
                      state: {
                        fromBillForm: true,
                        redirectPath: isEdit ? `/bills/edit/${id}` : '/bills/new',
                        ...(preFilledPhone ? { preFill: { phone: preFilledPhone } } : {}),
                      },
                    });
                  }} variant="secondary" size="sm" className="w-full mt-2 text-[10px]" icon={ICONS.Plus}>Add New Vendor</Button>
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
            <input type="text" value={billNumber} onChange={e => setBillNumber(e.target.value)} className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl font-mono ${theme.colors.secondary[700]} text-sm font-bold" />
          </div>
        </div>

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
                      {products.find(p => p.id === item.productId)?.image && (
                        <img src={products.find(p => p.id === item.productId)?.image} className="w-12 h-12 rounded-full object-cover border border-gray-100 shadow-sm" />
                      )}
                      <span className="font-bold text-gray-800 text-sm">{item.productName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center text-sm font-bold text-gray-600">{formatCurrency(item.rate)}</td>
                  <td className="px-4 py-4 text-center">
                    <input type="number" value={item.quantity} onChange={(e) => updateQuantity(idx, parseInt(e.target.value))} className="w-16 text-center py-2 border border-gray-100 rounded-xl focus:ring-2 focus:ring-[#3c5a82] font-bold outline-none" />
                  </td>
                  <td className="px-6 py-4 text-right font-black text-gray-900 text-sm">{formatCurrency(item.amount)}</td>
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
                    <Button onClick={() => setShowProductSearch(!showProductSearch)} variant="secondary" size="sm" icon={ICONS.Plus} className="border-2 border-dashed border-[#c7e0f5]">Add an item</Button>
                    {showProductSearch && (
                      <div className="absolute top-full left-0 mt-3 w-full max-w-md bg-white border border-gray-200 shadow-2xl rounded-lg z-[100] p-2 overflow-hidden animate-in slide-in-from-top-2 duration-200">
                        <div className="relative mb-2">
                          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-300">
                            {ICONS.Search}
                          </div>
                          <input autoFocus type="text" placeholder="Search product..." className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#3c5a82] text-sm font-medium" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                        <div className="max-h-[260px] overflow-y-auto space-y-0.5 custom-scrollbar">
                          {productsMiniLoading || productsSearchLoading ? (
                            <div className="p-4 space-y-3">
                              <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                              <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                              <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                            </div>
                          ) : products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 ? (
                            <div className="p-4 text-center text-gray-400 text-sm font-medium">No products found</div>
                          ) : (
                            products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).map(p => (
                              <button key={p.id} onClick={() => addItem(p.id)} className="flex items-center gap-4 w-full px-4 py-3 text-left hover:bg-[#e6f0ff] rounded-xl group transition-all">
                                {p.image && (
                                  <img src={p.image} className="w-10 h-10 rounded-full object-cover border border-gray-100 shadow-sm" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-gray-800 group-hover:${theme.colors.secondary[700]} truncate">{p.name}</p>
                                  <p className="text-[10px] font-bold ${theme.colors.secondary[600]}/60 uppercase tracking-widest">Cost: {formatCurrency(p.purchasePrice)}</p>
                                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Current Stock: {p.stock ?? 0}</p>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
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
          <div className="w-full md:w-96 space-y-4 bg-gray-50/50 p-8 rounded-[2rem] border border-gray-100">
            <div className="flex justify-between items-center text-gray-500 text-sm font-bold uppercase tracking-widest"><span>Subtotal</span><span className="text-gray-900 font-black">{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between items-center text-gray-500 text-sm font-bold uppercase tracking-widest"><span>Discount</span><input type="number" value={discount} onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)} className="w-24 text-right px-3 py-1.5 border border-gray-100 rounded-lg focus:ring-2 focus:ring-[#3c5a82] font-black text-gray-900 bg-white" /></div>
            <div className="flex justify-between items-center text-gray-500 text-sm font-bold uppercase tracking-widest"><span>Shipping</span><input type="number" value={shipping} onChange={(e) => setShipping(parseFloat(e.target.value) || 0)} className="w-24 text-right px-3 py-1.5 border border-gray-100 rounded-lg focus:ring-2 focus:ring-[#3c5a82] font-black text-gray-900 bg-white" /></div>
            <div className="pt-6 border-t-4 border-[#c7e0f5] flex justify-between items-center"><span className="text-lg font-bold text-gray-900 uppercase tracking-tighter">Total Bill</span><span className="text-lg font-black">{formatCurrency(total)}</span></div>
            <Button 
              onClick={handleSave}
              variant="primary"
              size="lg"
              className="w-full mt-4"
              loading={saving}
              disabled={saving}
            >
              Save Purchase Bill
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BillForm;



