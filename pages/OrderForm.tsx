
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Customer, Order, OrderStatus, OrderItem } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button, NumericInput, DuplicateOrderModal } from '../components';
import { theme } from '../theme';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useCompanySettings, useCustomer, useMetaAds, useOrder, useOrderSettings, useOrdersByCustomerId } from '../src/hooks/useQueries';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { fetchProductsMini, fetchProductsSearch, fetchCustomersPage, getNextOrderNumber, getErrorMessage } from '../src/services/supabaseQueries';
import { useLocation } from 'react-router-dom';
import { useCreateOrder, useUpdateOrder } from '../src/hooks/useMutations';
import { isTempId, waitForRealId } from '../src/utils/optimisticIdMap';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useAuth } from '../src/contexts/AuthProvider';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { getTodayDate, sanitizePhoneInput } from '../utils';
import { buildOrderPageSnapshot, getGlobalCompanyPage, normalizeCompanyPage, normalizeCompanySettings } from '../src/utils/companyPages';

type CustomerSearchOption = Pick<Customer, 'id' | 'name'> & Partial<Customer>;

const OrderForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { can, canAccessRecord, isAdminAccessUser } = useRolePermissions();
  const { hasCapability } = useCapabilities();
  const hasMarketing = hasCapability('marketing');
  const isEdit = Boolean(id);

  // Wait for auth to load before rendering form
  if (authLoading) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Loading...</h2>
        <p className="text-gray-500 mb-6">Authenticating session...</p>
      </div>
    );
  }

  // Safety check - user not logged in
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
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Lightweight fetch used only when the product search dropdown opens.
  const { data: productsMini = [], isFetching: productsMiniLoading } = useQuery({
    queryKey: ['productsMini'],
    queryFn: () => fetchProductsMini(),
    staleTime: 5 * 60 * 1000,
    enabled: false, // we'll trigger by setting `showProductSearch` below
    refetchOnWindowFocus: false,
  });

  // When user opens the product search, enable fetching lightweight list if no full cache exists.
  React.useEffect(() => {
    if (!showProductSearch) return;
    const full = queryClient.getQueryData<any[]>(['products']);
    if (!full || full.length === 0) {
      // trigger the lightweight fetch
      queryClient.fetchQuery({ queryKey: ['productsMini'], queryFn: () => fetchProductsMini() }).catch(() => {});
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
  const { data: existingOrderData, isPending: existingOrderLoading } = useOrder(isEdit ? id : undefined);
  const { data: metaAdsData } = useMetaAds({ status: 'ACTIVE' }, true);
  const { data: orderSettings } = useOrderSettings();
  const { data: companySettings, isPending: companySettingsLoading } = useCompanySettings();
  
  // Mutations
  const createMutation = useCreateOrder();
  const updateMutation = useUpdateOrder();
  const toast = useToastNotifications();

  // Form state
  const [customerId, setCustomerId] = useState('');
  const [pageId, setPageId] = useState('');
  const [sourceAdId, setSourceAdId] = useState('');
  const [orderDate, setOrderDate] = useState(getTodayDate());
  const [orderNumber, setOrderNumber] = useState('Generating...');
  const [orderNumberLoading, setOrderNumberLoading] = useState(false);
  const [items, setItems] = useState<OrderItem[]>([]);
  // Keep discount/shipping as strings for the inputs to avoid
  // controlled-number UX problems; parse when calculating/saving.
  const [discount, setDiscount] = useState('0');
  const [shipping, setShipping] = useState('0');
  const [notes, setNotes] = useState('');
  
  
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [custSearchTerm, setCustSearchTerm] = useState('');
  const [showSourceAdSearch, setShowSourceAdSearch] = useState(false);
  const [sourceAdSearchTerm, setSourceAdSearchTerm] = useState('');
  const [debouncedCustSearch, setDebouncedCustSearch] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedCustSearch(custSearchTerm.trim()), 300);
    return () => clearTimeout(t);
  }, [custSearchTerm]);
  const [debouncedSourceAdSearch, setDebouncedSourceAdSearch] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSourceAdSearch(sourceAdSearchTerm.trim()), 300);
    return () => clearTimeout(t);
  }, [sourceAdSearchTerm]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Duplicate order modal state
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateOrder, setDuplicateOrder] = useState<Order | null>(null);
  const [pendingOrderData, setPendingOrderData] = useState<any>(null);

  // Customers: fetch just the visible search window instead of the full list.
  const custPageSize = 20;
  const { data: customersPage, isFetching: customersFetching } = useQuery({
    queryKey: ['customers', 1, custPageSize, debouncedCustSearch],
    queryFn: () => fetchCustomersPage(1, custPageSize, debouncedCustSearch),
    enabled: showCustomerSearch,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const { data: selectedCustomerRecord } = useCustomer(customerId || undefined);
  const { data: customerOrders = [] } = useOrdersByCustomerId(customerId || undefined);
  const normalizedCompanySettings = React.useMemo(
    () => normalizeCompanySettings(companySettings),
    [companySettings],
  );
  const companyPages = normalizedCompanySettings.pages;
  const archivedPageOption = React.useMemo(() => {
    if (!existingOrderData?.pageSnapshot || Object.keys(existingOrderData.pageSnapshot).length === 0) {
      return null;
    }

    const snapshotPage = normalizeCompanyPage(existingOrderData.pageSnapshot, companyPages.length);
    return companyPages.some((page) => page.id === snapshotPage.id) ? null : snapshotPage;
  }, [companyPages, existingOrderData?.pageSnapshot]);
  const availablePages = React.useMemo(
    () => (archivedPageOption ? [...companyPages, archivedPageOption] : companyPages),
    [archivedPageOption, companyPages],
  );
  const selectedPage = React.useMemo(
    () => availablePages.find((page) => page.id === pageId) || null,
    [availablePages, pageId],
  );
  const activeAds = React.useMemo(() => {
    const ads = Array.isArray(metaAdsData?.ads) ? metaAdsData.ads : [];
    return ads.filter((ad: any) => {
      const status = String(ad?.status ?? '').toUpperCase();
      return status === 'ACTIVE' || status === 'ENABLED' || status === 'LIVE' || status === 'RUNNING';
    });
  }, [metaAdsData?.ads]);
  const sourceAdOptions = React.useMemo(() => {
    const fixedOption = { id: '', label: 'Not from an ad', metaAdId: '', platformName: '', name: 'Not from an ad' };
    const search = debouncedSourceAdSearch.toLowerCase();
    const adOptions = activeAds
      .filter((ad: any) => {
        if (!search) return true;
        const haystack = `${ad?.name ?? ''} ${ad?.metaAdId ?? ''} ${ad?.platformName ?? ''}`.toLowerCase();
        return haystack.includes(search);
      })
      .map((ad: any) => ({
        id: ad?.id ?? '',
        label: ad?.name ?? 'Untitled ad',
        metaAdId: ad?.metaAdId ?? '',
        platformName: ad?.platformName ?? 'Meta',
        name: ad?.name ?? 'Untitled ad',
      }));
    return [fixedOption, ...adOptions];
  }, [activeAds, debouncedSourceAdSearch]);
  const selectedSourceAd = React.useMemo(() => sourceAdOptions.find((option) => option.id === sourceAdId) || null, [sourceAdId, sourceAdOptions]);

  const seedCustomerCache = (customer: Pick<Customer, 'id'> & Partial<Customer>) => {
    if (!customer.id) return;
    queryClient.setQueryData(['customer', customer.id], (existing: Customer | null | undefined) => ({
      id: customer.id,
      name: customer.name ?? existing?.name ?? '',
      phone: customer.phone ?? existing?.phone ?? '',
      address: customer.address ?? existing?.address ?? '',
      totalOrders: customer.totalOrders ?? existing?.totalOrders ?? 0,
      dueAmount: customer.dueAmount ?? existing?.dueAmount ?? 0,
      createdBy: customer.createdBy ?? existing?.createdBy,
    }));
  };

  // Initialize form with existing order data when loaded
  const initializedRef = React.useRef(false);

  React.useEffect(() => {
    // Only initialize the local form state once from server data. This
    // prevents background refetches of `existingOrderData` from resetting
    // user input while editing.
    if (existingOrderData && !initializedRef.current) {
      if (isEdit) {
          // Allow edits when order is On Hold. Also allow Admin/Developer users
          // to edit orders that are in Picked status.
          if (existingOrderData.status !== OrderStatus.ON_HOLD) {
            const allowedForPicked = existingOrderData.status === OrderStatus.PICKED && isAdminAccessUser;
            if (!allowedForPicked) {
              toast.warning('Orders can only be edited when they are in On Hold status.');
              navigate('/orders');
              return;
            }
          }

          const canEditExistingOrder =
            // Admin/Developer can edit picked orders regardless of scoped permissions
            (isAdminAccessUser && existingOrderData.status === OrderStatus.PICKED)
            || can('orders.editAny')
            || canAccessRecord(existingOrderData.createdBy, 'orders.editOwn', 'orders.editAny');

          if (!canEditExistingOrder) {
            toast.warning('You do not have permission to edit this order.');
            navigate('/orders');
            return;
          }
      }

      // For admins (or permitted employees) populate form once
      seedCustomerCache({
        id: existingOrderData.customerId,
        name: existingOrderData.customerName,
        phone: existingOrderData.customerPhone,
        address: existingOrderData.customerAddress,
      });
      setPageId(existingOrderData.pageId || existingOrderData.pageSnapshot?.id || '');
      setSourceAdId(existingOrderData.sourceAd || '');
      setCustomerId(existingOrderData.customerId);
      setOrderDate(existingOrderData.orderDate);
      setOrderNumber(existingOrderData.orderNumber);
      setItems(existingOrderData.items);
      setDiscount(String(existingOrderData.discount ?? 0));
      setShipping(String(existingOrderData.shipping ?? 0));
      setNotes(existingOrderData.notes || '');
      initializedRef.current = true;
    } else if (!isEdit) {
      // For new orders, fetch the next order number from the server
      setOrderNumberLoading(true);
      getNextOrderNumber()
        .then(nextNumber => {
          setOrderNumber(nextNumber);
          initializedRef.current = true;
        })
        .catch(err => {
          console.error('Failed to fetch next order number:', err);
          setOrderNumber('ERROR');
          toast.error('Failed to generate order number. Please refresh the page.');
        })
        .finally(() => setOrderNumberLoading(false));
    }
  }, [can, canAccessRecord, existingOrderData, isEdit, navigate, normalizedCompanySettings, toast, user?.id]);

  // Reset the initialization flag when switching to a different order id
  React.useEffect(() => {
    initializedRef.current = false;
  }, [id]);

  React.useEffect(() => {
    if (companySettingsLoading || pageId || companyPages.length === 0) {
      return;
    }

    if (isEdit && !existingOrderData) {
      return;
    }

    const defaultPageId =
      existingOrderData?.pageId ||
      existingOrderData?.pageSnapshot?.id ||
      getGlobalCompanyPage(normalizedCompanySettings).id;

    if (defaultPageId) {
      setPageId(defaultPageId);
    }
  }, [companyPages.length, companySettingsLoading, existingOrderData, isEdit, normalizedCompanySettings, pageId]);

  // If redirected back from creating a new customer, pre-select it (read query param first, then fallback to location.state)
  const location = useLocation();
  React.useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      const selectedFromQuery = params.get('selectedCustomerId');
      if (selectedFromQuery) {
        setCustomerId(selectedFromQuery);
        // remove the query param without reloading
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, newUrl);
        return;
      }
    } catch (e) {
      // ignore
    }

    const state: any = (location && (location as any).state) || {};
    if (state.selectedCustomerId) {
      setCustomerId(state.selectedCustomerId);
      try {
        window.history.replaceState({}, document.title);
      } catch (e) {
        // ignore
      }
    }
  }, [location]);

  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const parsedDiscount = parseFloat(discount) || 0;
  const parsedShipping = parseFloat(shipping) || 0;
  const total = subtotal - parsedDiscount + parsedShipping;

  const addItem = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    if ((product.stock ?? 0) <= 0) {
      toast.warning(`"${product.name}" is out of stock — will be created On Hold.`);
    }

    const newItem: OrderItem = {
      productId: product.id,
      productName: product.name,
      rate: product.salePrice,
      quantity: 1,
      amount: product.salePrice
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

  const checkForDuplicateOrder = (orderItems: OrderItem[]): Order | null => {
    if (!customerOrders || customerOrders.length === 0) return null;
    
    // Sort items by productId for comparison
    const newItemsKey = orderItems
      .map(item => `${item.productId}:${item.quantity}`)
      .sort()
      .join('|');

    // Check existing orders for same product set
    for (const existingOrder of customerOrders) {
      if (!existingOrder.items || existingOrder.items.length !== orderItems.length) {
        continue;
      }

      const existingItemsKey = existingOrder.items
        .map(item => `${item.productId}:${item.quantity}`)
        .sort()
        .join('|');

      if (newItemsKey === existingItemsKey) {
        return existingOrder;
      }
    }

    return null;
  };

  const handleCustomerSelect = (customer: CustomerSearchOption) => {
    seedCustomerCache(customer);
    setCustomerId(customer.id);
    setShowCustomerSearch(false);
    setCustSearchTerm('');
  };

  const handleSave = async () => {
    if (!pageId || !customerId || items.length === 0 || !orderNumber || orderNumber === 'Generating...' || orderNumber === 'ERROR') {
      const msg = !pageId
        ? 'Please select a page.'
        : !customerId
          ? 'Please select a customer.'
          : !items.length
            ? 'Please add at least one product.'
            : 'Order number is still being generated. Please wait a moment.';
      setError(msg);
      toast.error(msg);
      return;
    }

    if (!user?.id) {
      toast.error('User session expired. Please log in again.');
      setError('User session expired. Please log in again.');
      return;
    }

    // Check for duplicate orders (only if creating new order, not editing)
    if (!isEdit) {
      const duplicateOrderFound = checkForDuplicateOrder(items);
      if (duplicateOrderFound) {
        setDuplicateOrder(duplicateOrderFound);
        setShowDuplicateModal(true);
        
        // Prepare order data for later use
        const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
        const parsedDiscount = parseFloat(discount) || 0;
        const parsedShipping = parseFloat(shipping) || 0;
        const total = subtotal - parsedDiscount + parsedShipping;
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' });
        
        setPendingOrderData({
          orderNumber,
          orderDate,
          customerId,
          pageId,
          sourceAdId,
          selectedPage,
          items,
          subtotal,
          discount: parsedDiscount,
          shipping: parsedShipping,
          total,
          dateStr,
          timeStr,
        });
        return;
      }
    }

    setSaving(true);
    setError(null);

    try {
      const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
      const parsedDiscount = parseFloat(discount) || 0;
      const parsedShipping = parseFloat(shipping) || 0;
      const total = subtotal - parsedDiscount + parsedShipping;
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' });

      // Resolve temporary customer id (if any) to a real id before saving.
      let finalCustomerId = customerId;
      if (isTempId(finalCustomerId)) {
        const realId = await waitForRealId(finalCustomerId, 7000);
        if (!realId) {
          const msg = 'Customer is still being saved. Please wait a moment and try again.';
          setError(msg);
          toast.error(msg);
          return;
        }
        finalCustomerId = realId;
      }

      const orderData: any = {
        orderNumber,
        orderDate,
        customerId: finalCustomerId,
        pageId,
        sourceAd: sourceAdId || null,
        pageSnapshot: buildOrderPageSnapshot(selectedPage),
        createdBy: '', // Will be auto-set by server
        status: isEdit && existingOrderData ? existingOrderData.status : OrderStatus.ON_HOLD,
        items,
        subtotal,
        discount: parsedDiscount,
        shipping: parsedShipping,
        total,
        notes,
        paidAmount: isEdit && existingOrderData ? existingOrderData.paidAmount : 0,
        history: isEdit && existingOrderData ? existingOrderData.history : {
          created: `${user.name} created this order on ${dateStr}, at ${timeStr}`
        },
      };

      if (isEdit) {
        await updateMutation.mutateAsync({ id: id!, updates: orderData });
        toast.success('Order updated successfully');
        navigate('/orders');
      } else {
        const createdOrder = await createMutation.mutateAsync(orderData as any);
        toast.success('Order created successfully');
        navigate(`/orders/${createdOrder.id}`, { state: { from: '/orders', refreshOrdersOnBack: true } });
      }
    } catch (err) {
      console.error('Failed to save order:', err);
      const errorMsg = getErrorMessage(err);
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDuplicateOrder = async () => {
    if (!pendingOrderData || !user?.id) {
      toast.error('Something went wrong. Please try again.');
      setShowDuplicateModal(false);
      return;
    }

    setSaving(true);

    try {
      // Resolve temporary customer id if needed
      let finalCustomerId = pendingOrderData.customerId;
      if (isTempId(finalCustomerId)) {
        const realId = await waitForRealId(finalCustomerId, 7000);
        if (!realId) {
          const msg = 'Customer is still being saved. Please wait a moment and try again.';
          setError(msg);
          toast.error(msg);
          setSaving(false);
          return;
        }
        finalCustomerId = realId;
      }

      const orderData: any = {
        orderNumber: pendingOrderData.orderNumber,
        orderDate: pendingOrderData.orderDate,
        customerId: finalCustomerId,
        pageId: pendingOrderData.pageId,
        sourceAd: pendingOrderData.sourceAdId || null,
        pageSnapshot: buildOrderPageSnapshot(pendingOrderData.selectedPage),
        createdBy: '', // Will be auto-set by server
        status: OrderStatus.ON_HOLD,
        items: pendingOrderData.items,
        subtotal: pendingOrderData.subtotal,
        discount: pendingOrderData.discount,
        shipping: pendingOrderData.shipping,
        total: pendingOrderData.total,
        notes,
        paidAmount: 0,
        history: {
          created: `${user.name} created this order on ${pendingOrderData.dateStr}, at ${pendingOrderData.timeStr}`
        },
      };

      const createdOrder = await createMutation.mutateAsync(orderData as any);
      toast.success('Order created successfully');
      setShowDuplicateModal(false);
      setPendingOrderData(null);
      setDuplicateOrder(null);
      navigate(`/orders/${createdOrder.id}`, { state: { from: '/orders', refreshOrdersOnBack: true } });
    } catch (err) {
      console.error('Failed to save order:', err);
      const errorMsg = getErrorMessage(err);
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelDuplicate = () => {
    setShowDuplicateModal(false);
    setPendingOrderData(null);
    setDuplicateOrder(null);
  };

  const baseVisibleCustomers = React.useMemo<CustomerSearchOption[]>(() => {
    return customersPage?.data || [];
  }, [customersPage?.data]);
  const selectedCustomer =
    selectedCustomerRecord ||
    baseVisibleCustomers.find((customer) => customer.id === customerId) ||
    (existingOrderData?.customerId === customerId
      ? {
          id: existingOrderData.customerId,
          name: existingOrderData.customerName || '',
          phone: existingOrderData.customerPhone || '',
          address: existingOrderData.customerAddress || '',
          totalOrders: 0,
          dueAmount: 0,
        }
      : undefined);
  const allVisibleCustomers =
    selectedCustomer && !baseVisibleCustomers.some((customer) => customer.id === selectedCustomer.id)
      ? [selectedCustomer, ...baseVisibleCustomers]
      : baseVisibleCustomers;

  if (isEdit && !existingOrderLoading && !existingOrderData) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Order Unavailable</h2>
        <p className="text-gray-500 mb-6">This order could not be found or is no longer available.</p>
        <Button onClick={() => navigate('/orders')} variant="primary">Back to Orders</Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Order' : 'New Order'}</h2>
        <button onClick={() => navigate('/orders')} className="text-gray-500 hover:text-gray-700 font-medium text-sm px-4 py-2 border border-gray-200 rounded-lg bg-white transition-all">
          Cancel
        </button>
      </div>

      <div className="bg-white p-6 rounded-lg border border-gray-100 shadow-sm space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-1 relative md:col-span-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Select Customer</label>
            <div className="relative">
              <button 
                onClick={() => setShowCustomerSearch(!showCustomerSearch)}
                className="w-full text-left px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl hover:bg-white focus:ring-2 focus:ring-[#3c5a82] transition-all flex justify-between items-center group"
              >
                {selectedCustomer ? (
                  <div className="flex-1 overflow-hidden">
                    <span className="font-bold block text-sm text-gray-900">{selectedCustomer.name}</span>
                    <p className="text-[10px] text-gray-500 leading-none mt-0.5">{selectedCustomer.phone}</p>
                    <p className="text-[10px] ${theme.colors.primary[600]} italic truncate mt-1">{selectedCustomer.address}</p>
                  </div>
                ) : <span className="text-gray-400 text-sm">Select Customer...</span>}
                <div className={`transition-transform duration-200 ${showCustomerSearch ? 'rotate-90' : ''}`}>
                   {ICONS.ChevronRight}
                </div>
              </button>
              
              {showCustomerSearch && (
                <div className="absolute top-full left-0 mt-2 w-full max-w-xs bg-white border border-gray-200 shadow-2xl rounded-lg z-[110] p-2 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                  <div className="relative mb-2">
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-300">
                      {ICONS.Search}
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
                      (allVisibleCustomers || []).map((c: any) => (
                        <button 
                          key={c.id} 
                          onClick={() => handleCustomerSelect(c)} 
                          className="w-full px-4 py-2.5 text-left hover:bg-[#ebf4ff] rounded-lg group transition-colors"
                        >
                          <p className="text-sm font-bold text-gray-800 group-hover:${theme.colors.primary[700]}">{c.name}</p>
                          <p className="text-[10px] text-gray-400 group-hover:${theme.colors.primary[600]}/60">{c.phone}</p>
                        </button>
                      ))
                    )}
                  </div>
                  <button 
                    onClick={() => {
                      const preFilledPhone = sanitizePhoneInput(custSearchTerm);
                      setShowCustomerSearch(false);
                      navigate('/customers/new', {
                        state: {
                          fromOrderForm: true,
                          redirectPath: isEdit ? `/orders/edit/${id}` : '/orders/new',
                          ...(preFilledPhone ? { preFill: { phone: preFilledPhone } } : {}),
                        },
                      });
                    }} 
                    className="w-full mt-2 py-3 ${theme.colors.primary[600]} text-[10px] font-black uppercase tracking-widest border-t border-gray-50 hover:bg-[#ebf4ff] transition-colors"
                  >
                    + Add New Customer
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Order Date</label>
            <input 
              type="date" 
              value={orderDate} 
              onChange={(e) => setOrderDate(e.target.value)} 
              className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-[#3c5a82] focus:bg-white transition-all cursor-pointer font-bold text-sm" 
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Order Number</label>
            <input 
              type="text" 
              readOnly 
              value={orderNumber}
              placeholder="Generating..."
              className={`w-full px-4 py-3 bg-gray-100 border border-gray-100 rounded-xl font-mono text-sm font-bold ${orderNumber === 'ERROR' ? 'text-red-600' : ``}`} 
            />
          </div>
        </div>

        <div className={`grid grid-cols-1 gap-6 ${availablePages.length > 1 && hasMarketing ? 'md:grid-cols-2' : ''}`}>
          {availablePages.length > 1 && (
          <div className="space-y-1">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Select Page</label>
            <select
              value={pageId}
              onChange={(event) => setPageId(event.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-[#3c5a82] focus:bg-white transition-all font-bold text-sm"
            >
              <option value="">Select Page...</option>
              {availablePages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
            {selectedPage && (
              <p className="ml-1 text-[10px] font-medium text-gray-500">
                {selectedPage.phone}
                {selectedPage.email ? ` • ${selectedPage.email}` : ''}
              </p>
            )}
          </div>
          )}

          {hasMarketing && (
          <div className="space-y-1 relative">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Source Ad</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSourceAdSearch(!showSourceAdSearch)}
                className="w-full text-left px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl hover:bg-white focus:ring-2 focus:ring-[#3c5a82] transition-all flex justify-between items-center group"
              >
                <div className="flex-1 overflow-hidden">
                  <span className="font-bold block text-sm text-gray-900">{selectedSourceAd ? selectedSourceAd.label : 'Not from an ad'}</span>
                  <p className="text-[10px] text-gray-500 leading-none mt-0.5">
                    {selectedSourceAd && selectedSourceAd.id !== '' ? (selectedSourceAd.metaAdId ? `Ad ID: ${selectedSourceAd.metaAdId}` : `Platform: ${selectedSourceAd.platformName}`) : 'No ad attribution'}
                  </p>
                </div>
                <div className={`transition-transform duration-200 ${showSourceAdSearch ? 'rotate-90' : ''}`}>
                  {ICONS.ChevronRight}
                </div>
              </button>
              {showSourceAdSearch && (
                <div className="absolute top-full left-0 mt-2 w-full bg-white border border-gray-200 shadow-2xl rounded-lg z-[110] p-2 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                  <div className="relative mb-2">
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-300">
                      {ICONS.Search}
                    </div>
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search ad name or ID..."
                      className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#3c5a82] text-sm font-medium"
                      value={sourceAdSearchTerm}
                      onChange={(e) => setSourceAdSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="max-h-[220px] overflow-y-auto space-y-0.5 custom-scrollbar">
                    {sourceAdOptions.length === 0 ? (
                      <div className="p-4 text-center text-gray-400 text-sm font-medium">No active ads found</div>
                    ) : (
                      sourceAdOptions.map((option) => (
                        <button
                          key={option.id || 'not-from-ad'}
                          type="button"
                          onClick={() => { setSourceAdId(option.id || ''); setShowSourceAdSearch(false); setSourceAdSearchTerm(''); }}
                          className="w-full px-4 py-2.5 text-left hover:bg-[#ebf4ff] rounded-lg group transition-colors"
                        >
                          <p className="text-sm font-bold text-gray-800 group-hover:${theme.colors.primary[700]}">{option.label}</p>
                          {option.id ? (
                            <p className="text-[10px] text-gray-500 group-hover:${theme.colors.primary[600]}/60">{option.platformName ? `${option.platformName} • Ad ID: ${option.metaAdId}` : `Ad ID: ${option.metaAdId}`}</p>
                          ) : (
                            <p className="text-[10px] text-gray-500">Select this if the order was not created from an ad</p>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          )}
        </div>

        <div className="border border-gray-100 rounded-lg overflow-x-auto bg-white">
          <table className="w-full min-w-max text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Product Item</th>
                <th className="px-4 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Rate</th>
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
                    <NumericInput 
                      value={item.quantity} 
                      onChange={(value) => updateQuantity(idx, value)} 
                      className="w-16 text-center border border-gray-100 rounded-xl focus:ring-2 focus:ring-[#3c5a82] py-2"
                      allowDecimals={false}
                    />
                  </td>
                  <td className="px-6 py-4 text-right font-black text-gray-900 text-sm">{formatCurrency(item.amount)}</td>
                  <td className="px-4 py-4 text-right">
                    <button onClick={() => removeItem(idx)} className="p-2 text-red-200 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                      {ICONS.Delete}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="relative mt-2">
          <button 
            onClick={() => setShowProductSearch(!showProductSearch)} 
            className="flex items-center gap-2 ${theme.colors.primary[600]} font-black text-[10px] uppercase tracking-widest hover:bg-[#ebf4ff] px-4 py-2.5 rounded-xl border-2 border-dashed border-[#c7dff5] transition-all"
          >
            {ICONS.Plus} Add an item
          </button>
          
          {showProductSearch && (
            <div className="absolute top-full left-0 mt-2 w-full max-w-md bg-white border border-gray-200 shadow-2xl rounded-lg z-[100] p-2 animate-in slide-in-from-top-2 duration-200">
              <div className="relative mb-2">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-300">
                  {ICONS.Search}
                </div>
                <input 
                  autoFocus 
                  type="text" 
                  placeholder="Search catalog..." 
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#3c5a82] text-sm font-medium" 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)} 
                />
              </div>
              <div className="max-h-[260px] overflow-y-auto space-y-0.5 custom-scrollbar">
                {products.length === 0 && (productsMiniLoading || productsSearchLoading) ? (
                  <div className="p-4 space-y-3">
                    <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                    <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                    <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                  </div>
                ) : products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 ? (
                  <div className="p-4 text-center text-gray-400 text-sm font-medium">No products found</div>
                ) : (
                  products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())).map(p => (
                    <button
                      key={p.id}
                      onClick={() => addItem(p.id)}
                      className="flex items-center gap-4 w-full px-4 py-3 text-left hover:bg-[#ebf4ff] rounded-xl group transition-all"
                    >
                      {p.image && (
                        <img src={p.image} className="w-10 h-10 rounded-full object-cover border border-gray-100 shadow-sm" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-800 group-hover:${theme.colors.primary[700]} truncate">{p.name}</p>
                        <p className="text-[10px] font-bold ${theme.colors.primary[600]}/60 uppercase tracking-widest">{formatCurrency(p.salePrice)}</p>
                        <p className={`text-[10px] font-bold uppercase tracking-widest ${p.stock <= 0 ? 'text-red-500' : 'text-gray-400'}`}>Stock: {p.stock ?? 0}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col md:flex-row justify-between gap-12 pt-6">
          <div className="flex-1 space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Order Notes / Terms</label>
            <textarea 
              placeholder="Internal notes or special instructions for this order..." 
              value={notes} 
              onChange={(e) => setNotes(e.target.value)} 
              className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-lg h-32 focus:ring-2 focus:ring-[#3c5a82] focus:bg-white outline-none font-medium text-sm transition-all" 
            />
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
                <NumericInput 
                  value={discount} 
                  onChange={(value) => setDiscount(value)} 
                  className="w-20 text-right py-1.5 border border-gray-100 rounded-lg focus:ring-2 focus:ring-[#3c5a82] text-gray-900 bg-white"
                  allowDecimals={true}
                  decimalPlaces={2}
                />
              </div>
            </div>
            <div className="flex justify-between items-center text-gray-500 text-[12px] font-bold uppercase tracking-widest">
              <span>Shipping</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-black">৳</span>
                <NumericInput
                  value={shipping}
                  onChange={(value) => setShipping(value)}
                  className="w-20 text-right py-1.5 border border-gray-100 rounded-lg focus:ring-2 focus:ring-[#3c5a82] text-gray-900 bg-white"
                  allowDecimals={true}
                  decimalPlaces={2}
                />
              </div>
            </div>
            <div className="pt-6 border-t-4 border-[#c7dff5] flex justify-between items-center">
              <span className="text-sm font-black text-gray-900 uppercase tracking-tighter">Total</span>
              <span className="text-sm font-black text-[#3c5a82]">{formatCurrency(total)}</span>
            </div>
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-bold text-red-600">{String(error)}</p>
              </div>
            )}
            <Button 
              onClick={handleSave}
              variant="primary"
              size="lg"
              className="w-full mt-4"
              disabled={saving}
              loading={saving}
            >
              {isEdit ? 'Update Order' : 'Create Order'}
            </Button>
          </div>
        </div>
      </div>

      <DuplicateOrderModal
        isOpen={showDuplicateModal}
        duplicateOrder={duplicateOrder}
        onConfirm={handleConfirmDuplicateOrder}
        onCancel={handleCancelDuplicate}
        isLoading={saving}
      />
    </div>
  );
};

export default OrderForm;

