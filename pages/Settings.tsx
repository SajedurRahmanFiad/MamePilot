import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '../db';
import { ICONS, formatCurrency } from '../constants';
import { Button, PermissionsSettingsPanel, NumericInput } from '../components';
import { theme } from '../theme';
import { OrderStatus, hasAdminAccess, type CompanyPage, type CourierSettings, type MetaAdsSettings, type PermissionsSettings, type Settings } from '../types';
import { 
  useCategories, usePaymentMethods, useUnits,
  useCompanySettings, useOrderSettings, useInvoiceSettings, 
  useSystemDefaults, useCourierSettings, useAccounts, useProducts, useWalletSettings, usePermissionsSettings, useMetaAdsConnectionStatus, useMetaAdsSettings, useMetaAdsSyncStatus
} from '../src/hooks/useQueries';
import { 
  useCreateCategory, useDeleteCategory, 
  useCreatePaymentMethod, useDeletePaymentMethod, 
  useCreateUnit, useDeleteUnit,
  useBatchUpdateSettings,
  useBeginMetaAdsOAuth,
  useSyncMetaAds,
  useUpdateMetaAdsSettings
} from '../src/hooks/useMutations';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { LoadingOverlay } from '../components';
import { fetchCarryBeeStores } from '../src/services/supabaseQueries';
import { normalizeCompanyPage, normalizeCompanySettings } from '../src/utils/companyPages';
import { clonePermissionsSettings, DEFAULT_ROLE_PERMISSION_SETTINGS } from '../src/utils/permissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlTab = searchParams.get('tab') || 'company';
  const [activeTab, setActiveTab] = useState(urlTab);
  const [showModal, setShowModal] = useState<'category' | 'payment' | 'unit' | null>(null);
  const [pagePendingRemoval, setPagePendingRemoval] = useState<{ pageId: string; pageName: string } | null>(null);
  const [pageRemovalConfirmText, setPageRemovalConfirmText] = useState('');
  const [pageRemovalError, setPageRemovalError] = useState('');
  const queryClient = useQueryClient();
  const {
    canEditCompanySettings,
    canEditOrderInvoiceSettings,
    canEditDefaults,
    canEditWalletSettings,
    canEditCourierSettings,
    canEditCategories,
    canEditPaymentMethods,
    canManagePermissions,
    canSyncAds,
  } = useRolePermissions();

  // Query data from React Query hooks
  const { data: companySettingsData, isPending: companyLoading } = useCompanySettings();
  const { data: orderSettingsData, isPending: orderLoading } = useOrderSettings();
  const { data: invoiceSettingsData, isPending: invoiceLoading } = useInvoiceSettings();
  const { data: systemDefaultsData, isPending: defaultsLoading } = useSystemDefaults();
  const { data: courierSettingsData, isPending: courierLoading } = useCourierSettings();
  const { data: walletSettingsData, isPending: walletLoading } = useWalletSettings();
  const { data: permissionsSettingsData, isPending: permissionsLoading } = usePermissionsSettings();
  const { data: metaAdsStatus, isPending: metaAdsLoading, refetch: refetchMetaAdsConnectionStatus } = useMetaAdsConnectionStatus(activeTab === 'meta-ads');
  const { data: metaAdsSettingsData, isPending: metaAdsSettingsLoading } = useMetaAdsSettings(activeTab === 'meta-ads');
  const { data: metaAdsSyncStatus, refetch: refetchMetaAdsSyncStatus } = useMetaAdsSyncStatus(activeTab === 'meta-ads');
  const syncMetaAdsMutation = useSyncMetaAds();
  const META_COOLDOWN_KEY = 'metaAdsCooldownEndAt';
  const [metaAdsCooldown, setMetaAdsCooldown] = useState(() => {
    const saved = localStorage.getItem(META_COOLDOWN_KEY);
    if (saved) {
      const remaining = Math.ceil((Number(saved) - Date.now()) / 1000);
      return remaining > 0 ? remaining : 0;
    }
    return 0;
  });
  const metaAdsCooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyMetaCooldown = useCallback((seconds: number) => {
    setMetaAdsCooldown(seconds);
    localStorage.setItem(META_COOLDOWN_KEY, String(Date.now() + seconds * 1000));
  }, []);
  const { data: categories = [], isPending: loadingCategories } = useCategories();
  const { data: paymentMethods = [], isPending: loadingPaymentMethods } = usePaymentMethods();
  const { data: units = [], isPending: loadingUnits } = useUnits();
  const { data: accounts = [] } = useAccounts();
  
  // Mutations
  const createCategoryMutation = useCreateCategory();
  const deleteCategoryMutation = useDeleteCategory();
  const createPaymentMutation = useCreatePaymentMethod();
  const deletePaymentMutation = useDeletePaymentMethod();
  const createUnitMutation = useCreateUnit();
  const deleteUnitMutation = useDeleteUnit();
  const batchUpdateMutation = useBatchUpdateSettings();
  const beginMetaAdsOAuthMutation = useBeginMetaAdsOAuth();
  const updateMetaAdsSettingsMutation = useUpdateMetaAdsSettings();
  const toast = useToastNotifications();

  // Meta Ads sync cooldown timer
  useEffect(() => {
    const serverCooldown = metaAdsSyncStatus?.cooldownRemainingSeconds ?? 0;
    if (serverCooldown > 0 && metaAdsCooldown === 0) {
      applyMetaCooldown(serverCooldown);
    }
  }, [metaAdsSyncStatus?.cooldownRemainingSeconds]);

  useEffect(() => {
    if (metaAdsCooldown <= 0) {
      if (metaAdsCooldownRef.current) {
        clearInterval(metaAdsCooldownRef.current);
        metaAdsCooldownRef.current = null;
      }
      return;
    }
    metaAdsCooldownRef.current = setInterval(() => {
      setMetaAdsCooldown((prev) => {
        if (prev <= 1) {
          if (metaAdsCooldownRef.current) clearInterval(metaAdsCooldownRef.current);
          metaAdsCooldownRef.current = null;
          localStorage.removeItem(META_COOLDOWN_KEY);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (metaAdsCooldownRef.current) {
        clearInterval(metaAdsCooldownRef.current);
        metaAdsCooldownRef.current = null;
      }
    };
  }, [metaAdsCooldown]);
  const { hasCapability } = useCapabilities(Boolean(user));

  // Local state for forms (these need to be maintained locally until save)
  const [companySettings, setCompanySettings] = useState<Settings['company']>(() => normalizeCompanySettings(db.settings.company));
  const [expandedCompanyPages, setExpandedCompanyPages] = useState<Record<string, boolean>>(() =>
    normalizeCompanySettings(db.settings.company).pages.reduce<Record<string, boolean>>((acc, page) => {
      acc[page.id] = false;
      return acc;
    }, {}),
  );
  const [orderSettings, setOrderSettings] = useState({ prefix: 'ORD-', nextNumber: 1 });
  const [courierSettings, setCourierSettings] = useState<CourierSettings>({
    steadfast: { baseUrl: '', apiKey: '', secretKey: '' },
    carryBee: { baseUrl: '', clientId: '', clientSecret: '', clientContext: '', storeId: '' },
    paperfly: { baseUrl: '', username: '', password: '', paperflyKey: '', defaultShopName: '', maxWeightKg: 0.3 },
    fraudChecker: { apiKey: '' },
  });
  const PAYROLL_STATUS_OPTIONS = [
    OrderStatus.ON_HOLD,
    OrderStatus.PROCESSING,
    OrderStatus.PICKED,
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
  ] as OrderStatus[];
  const [walletSettings, setWalletSettings] = useState({
    unitAmount: 0,
    countedStatuses: PAYROLL_STATUS_OPTIONS,
  });
  const payrollSettings = walletSettings;
  const [invoiceSettings, setInvoiceSettings] = useState({ title: 'Invoice', logoWidth: 120, logoHeight: 120, footer: '' });
  const [systemDefaults, setSystemDefaults] = useState<Settings['defaults']>({ 
    defaultAccountId: '', 
    defaultPaymentMethod: '', 
    incomeCategoryId: '', 
    expenseCategoryId: '', 
    recordsPerPage: 10,
    maxTransactionAmount: 0,
    whiteLabel: false,
    themeColor: '#0f2f57',
  });
  const [permissionsSettings, setPermissionsSettings] = useState<PermissionsSettings>(() =>
    clonePermissionsSettings(DEFAULT_ROLE_PERMISSION_SETTINGS),
  );
  const [metaAdsSettings, setMetaAdsSettings] = useState<MetaAdsSettings>({
    appId: '',
    appSecret: '',
    redirectUri: '',
    loginConfigId: '',
    graphVersion: 'v25.0',
    oauthScopes: 'public_profile,ads_read,business_management',
    displayCurrencyCode: 'BDT',
    displayCurrencyRateToBdt: null,
  });
  const [categoryForm, setCategoryForm] = useState({ name: '', type: 'Income' as string, color: '#10B981', parentId: '' });
  const [paymentForm, setPaymentForm] = useState({ name: '', description: '' });
  const [unitForm, setUnitForm] = useState({ name: '', shortName: '', description: '' });

  // CarryBee Stores state
  const [carryBeeStores, setCarryBeeStores] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingCarryBeeStores, setLoadingCarryBeeStores] = useState(false);

  // Initialize forms when data loads from React Query
  React.useEffect(() => {
    const normalized = normalizeCompanySettings(companySettingsData || db.settings.company);
    setCompanySettings(normalized);
    setExpandedCompanyPages(
      normalized.pages.reduce<Record<string, boolean>>((acc, page) => {
        acc[page.id] = false;
        return acc;
      }, {}),
    );
  }, [companySettingsData]);

  React.useEffect(() => {
    if (orderSettingsData) setOrderSettings(orderSettingsData);
  }, [orderSettingsData]);

  React.useEffect(() => {
    if (invoiceSettingsData) setInvoiceSettings(invoiceSettingsData);
  }, [invoiceSettingsData]);

  React.useEffect(() => {
    if (systemDefaultsData) {
      setSystemDefaults({
        ...systemDefaultsData,
        themeColor: systemDefaultsData.themeColor || '#0f2f57',
      });
    }
  }, [systemDefaultsData]);

  const isDeveloper = user?.role === 'Developer';

  React.useEffect(() => {
    if (courierSettingsData) setCourierSettings(courierSettingsData);
  }, [courierSettingsData]);

  React.useEffect(() => {
    if (!walletSettingsData) return;
    const countedStatuses = (walletSettingsData.countedStatuses || []).filter((status): status is OrderStatus =>
      PAYROLL_STATUS_OPTIONS.includes(status as OrderStatus)
    );
    setWalletSettings({
      ...walletSettingsData,
      countedStatuses: countedStatuses.length > 0 ? countedStatuses : PAYROLL_STATUS_OPTIONS,
    });
  }, [walletSettingsData]);

  React.useEffect(() => {
    if (permissionsSettingsData) {
      setPermissionsSettings(clonePermissionsSettings(permissionsSettingsData));
    }
  }, [permissionsSettingsData]);

  React.useEffect(() => {
    if (metaAdsSettingsData) {
      setMetaAdsSettings({
        appId: metaAdsSettingsData.appId || '',
        appSecret: metaAdsSettingsData.appSecret || '',
        redirectUri: metaAdsSettingsData.redirectUri || '',
        loginConfigId: metaAdsSettingsData.loginConfigId || '',
        graphVersion: metaAdsSettingsData.graphVersion || 'v25.0',
        oauthScopes: metaAdsSettingsData.oauthScopes || 'public_profile,ads_read,business_management',
        displayCurrencyCode: metaAdsSettingsData.displayCurrencyCode || 'BDT',
        displayCurrencyRateToBdt: metaAdsSettingsData.displayCurrencyRateToBdt ?? null,
      });
    }
  }, [metaAdsSettingsData]);

  React.useEffect(() => {
    if (urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }, [urlTab]); // Removed activeTab from dependencies to prevent unnecessary re-runs

  React.useEffect(() => {
    if (activeTab === 'developer') {
      if (!isDeveloper) {
        setActiveTab('company');
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete('tab');
        setSearchParams(nextParams, { replace: true });
        return;
      }

      navigate('/developer/settings', { replace: true });
      return;
    }

    const currentTab = searchParams.get('tab') || 'company';
    if (currentTab === activeTab) return;

    const nextParams = new URLSearchParams(searchParams);
    if (activeTab === 'company') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', activeTab);
    }
    setSearchParams(nextParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams, isDeveloper, navigate]);

  // Fetch CarryBee stores when credentials change (debounced to avoid rapid calls while typing)
  useEffect(() => {
    let timer: any = null;
    const fetchStores = async () => {
      const { baseUrl, clientId, clientSecret, clientContext } = courierSettings.carryBee;
      
      // Only fetch if all required fields are filled (trim whitespace)
      const trimmedBaseUrl = baseUrl?.trim();
      const trimmedClientId = clientId?.trim();
      const trimmedClientSecret = clientSecret?.trim();
      const trimmedClientContext = clientContext?.trim();
      
      if (!trimmedBaseUrl || !trimmedClientId || !trimmedClientSecret || !trimmedClientContext) {
        setCarryBeeStores([]);
        return;
      }

      setLoadingCarryBeeStores(true);
      try {
        const stores = await fetchCarryBeeStores({
          baseUrl: trimmedBaseUrl,
          clientId: trimmedClientId,
          clientSecret: trimmedClientSecret,
          clientContext: trimmedClientContext,
        });
        setCarryBeeStores(stores);
      } catch (err) {
        console.error('Failed to fetch CarryBee stores:', err);
        setCarryBeeStores([]);
      } finally {
        setLoadingCarryBeeStores(false);
      }
    };

    // Debounce: wait 700ms after last change
    timer = setTimeout(() => {
      fetchStores();
    }, 700);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [courierSettings.carryBee.baseUrl, courierSettings.carryBee.clientId, courierSettings.carryBee.clientSecret, courierSettings.carryBee.clientContext]);

  React.useEffect(() => {
    const result = searchParams.get('meta_ads');
    const message = searchParams.get('message') || '';
    if (!result) return;

    if (result === 'connected') {
      toast.success('Meta Ads connected and synchronized.');
      queryClient.invalidateQueries({ queryKey: ['meta-ads'], exact: false });
    } else if (result === 'error') {
      toast.error(message || 'Meta Ads connection failed.');
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('meta_ads');
    nextParams.delete('message');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, toast, queryClient]);

  const loading = companyLoading || orderLoading || invoiceLoading || defaultsLoading || courierLoading || walletLoading || permissionsLoading || loadingCategories || loadingPaymentMethods || loadingUnits || (activeTab === 'meta-ads' && (metaAdsLoading || metaAdsSettingsLoading));
  const updateCompanyPages = (updater: (pages: CompanyPage[]) => CompanyPage[]) => {
    setCompanySettings((current) => normalizeCompanySettings({
      ...current,
      pages: updater(current.pages),
    }));
  };

  const handleAddCompanyPage = () => {
    const newPageId = crypto.randomUUID();
    updateCompanyPages((pages) => [
      ...pages,
      normalizeCompanyPage(
        {
          id: newPageId,
          name: `Page ${pages.length + 1}`,
          logo: '',
          phone: '',
          email: '',
          address: '',
          isGlobalBranding: pages.length === 0, // First page should be marked as global branding
        },
        pages.length,
      ),
    ]);
    setExpandedCompanyPages((current) => ({ ...current, [newPageId]: true })); // Auto-expand first page for user to fill details
  };

  const handleCompanyPageChange = (pageId: string, key: 'name' | 'logo' | 'phone' | 'email' | 'address', value: string) => {
    updateCompanyPages((pages) =>
      pages.map((page) => (page.id === pageId ? normalizeCompanyPage({ ...page, [key]: value }) : page)),
    );
  };

  const handleCompanyPageLogoUpload = (pageId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      handleCompanyPageChange(pageId, 'logo', reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSetGlobalCompanyPage = (pageId: string) => {
    updateCompanyPages((pages) =>
      pages.map((page) => ({
        ...page,
        isGlobalBranding: page.id === pageId,
      })),
    );
  };

  const handleRemoveCompanyPage = (pageId: string) => {
    updateCompanyPages((pages) => {
      const remainingPages = pages.filter((page) => page.id !== pageId);
      return remainingPages.length > 0 ? remainingPages : pages;
    });
    setExpandedCompanyPages((current) => {
      const next = { ...current };
      delete next[pageId];
      return next;
    });
  };

  const handleRequestRemoveCompanyPage = (pageId: string, pageName: string) => {
    setPagePendingRemoval({ pageId, pageName });
    setPageRemovalConfirmText('');
    setPageRemovalError('');
  };

  const closePageRemovalModal = () => {
    setPagePendingRemoval(null);
    setPageRemovalConfirmText('');
    setPageRemovalError('');
  };

  const confirmRemoveCompanyPage = () => {
    if (!pagePendingRemoval) {
      return;
    }

    if (pageRemovalConfirmText !== pagePendingRemoval.pageName) {
      setPageRemovalError('Type the exact page name to confirm deletion.');
      return;
    }

    handleRemoveCompanyPage(pagePendingRemoval.pageId);
    closePageRemovalModal();
  };

  const toggleWalletStatus = (status: OrderStatus) => {
    setWalletSettings((current) => ({
      ...current,
      countedStatuses: current.countedStatuses.includes(status)
        ? current.countedStatuses.filter((value) => value !== status)
        : [...current.countedStatuses, status],
    }));
  };
  const togglePayrollStatus = toggleWalletStatus;

  const handleSave = async () => {
    const normalizedCompany = normalizeCompanySettings(companySettings);
    const hasUnnamedPage = normalizedCompany.pages.some((page) => !page.name.trim());
    if (hasUnnamedPage) {
      toast.warning('Please enter a page name for every company page.');
      return;
    }

    try {
      // Show toast immediately (optimistic UI)
      const toastId = toast.loading('Saving all settings...');
      const updates: any = {
        company: normalizedCompany,
        order: orderSettings,
        invoice: invoiceSettings,
        defaults: systemDefaults,
        wallet: walletSettings,
      };
      if (hasCapability('courier_automation')) {
        updates.courier = courierSettings;
      }
      if (hasCapability('custom_roles')) {
        updates.permissions = permissionsSettings;
      }
      
      // Save all settings in background without waiting
      batchUpdateMutation.mutateAsync(updates).then(() => {
        // Update mock db for backward compatibility
        db.settings.company = normalizedCompany;
        db.settings.order = orderSettings;
        db.settings.invoice = invoiceSettings;
        db.settings.defaults = systemDefaults;
        db.settings.courier = courierSettings;
        db.settings.permissions = permissionsSettings as any;
        db.settings.payroll = {
          ...db.settings.payroll,
          unitAmount: walletSettings.unitAmount,
          countedStatuses: walletSettings.countedStatuses,
        };
        
        // Update toast to success
        toast.update(toastId, 'Settings saved successfully!', 'success');
      }).catch((err) => {
        console.error('Failed to save settings:', err);
        toast.update(toastId, 'Failed to save settings: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
      });
    } catch (err) {
      console.error('Failed to initiate settings save:', err);
      toast.error('Failed to save settings: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleAddCategory = async () => {
    if (!categoryForm.name.trim()) {
      toast.warning('Please enter a category name');
      return;
    }
    
    // Create new category object with temporary ID
    const newCategory = {
      id: crypto.randomUUID(),
      name: categoryForm.name,
      type: categoryForm.type,
      color: categoryForm.color,
      parentId: categoryForm.parentId || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    // Optimistically update React Query cache immediately
    const previousCategories = queryClient.getQueryData(['categories']);
    queryClient.setQueryData(['categories'], (old: any[] = []) => [...old, newCategory]);
    
    // Show toast immediately
    const toastId = toast.loading('Adding category...');
    
    // Reset form and close modal
    const formData = { ...categoryForm };
    setCategoryForm({ name: '', type: 'Income', color: '#10B981', parentId: '' });
    setShowModal(null);
    
    try {
      // Save to database
      await createCategoryMutation.mutateAsync({
        name: formData.name,
        type: formData.type,
        color: formData.color,
        parentId: formData.parentId || undefined,
      });
      
      // Update toast to success
      toast.update(toastId, 'Category added successfully!', 'success');
    } catch (err) {
      console.error('Failed to add category:', err);
      // Rollback cache on error
      queryClient.setQueryData(['categories'], previousCategories);
      
      // Show error toast
      toast.update(toastId, 'Failed to add category: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
      
      // Reopen modal so user can try again
      setShowModal('category');
      setCategoryForm(formData);
    }
  };

  const handleSaveMetaAdsSettings = async () => {
    const toastId = toast.loading('Saving Meta Ads settings...');
    try {
      await updateMetaAdsSettingsMutation.mutateAsync(metaAdsSettings);
      toast.update(toastId, 'Meta Ads settings saved.', 'success');
      queryClient.invalidateQueries({ queryKey: ['meta-ads'], exact: false });
    } catch (err) {
      toast.update(toastId, err instanceof Error ? err.message : 'Failed to save Meta Ads settings.', 'error');
    }
  };

  const handleConnectMetaAds = async () => {
    try {
      const response = await beginMetaAdsOAuthMutation.mutateAsync({ redirectAfter: '/settings?tab=meta-ads' });
      window.location.href = response.authUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start Meta login.');
    }
  };

  // Track last synced time so we can detect when a background sync completes
  const lastSyncedAtRef = useRef<string | null>(metaAdsSyncStatus?.lastSyncedAt ?? null);

  // When sync status changes (background sync completed), refresh connection status automatically
  useEffect(() => {
    const currentLastSynced = metaAdsSyncStatus?.lastSyncedAt ?? null;
    if (currentLastSynced && currentLastSynced !== lastSyncedAtRef.current) {
      lastSyncedAtRef.current = currentLastSynced;
      queryClient.invalidateQueries({ queryKey: ['meta-ads'], exact: false });
      refetchMetaAdsConnectionStatus();
    }
  }, [metaAdsSyncStatus?.lastSyncedAt, queryClient, refetchMetaAdsConnectionStatus]);

  const handleSyncMetaAds = useCallback(async () => {
    if (metaAdsCooldown > 0 || syncMetaAdsMutation.isPending) return;
    const toastId = toast.loading('Starting Meta Ads sync...');
    try {
      const result = await syncMetaAdsMutation.mutateAsync();
      if (result?.ok === false && result?.cooldownRemainingSeconds > 0) {
        applyMetaCooldown(result.cooldownRemainingSeconds);
        toast.update(toastId, 'Sync rate-limited. Please wait ' + result.cooldownRemainingSeconds + 's.', 'error');
      } else if (result?.started) {
        // Background sync started — don't await completion
        applyMetaCooldown(120);
        toast.update(toastId, 'Sync started. Data will refresh automatically when ready.', 'success');
      } else {
        // Synchronous fallback completed
        applyMetaCooldown(120);
        toast.update(toastId, 'Meta Ads synced successfully.', 'success');
        await queryClient.invalidateQueries({ queryKey: ['meta-ads'], exact: false });
        await refetchMetaAdsSyncStatus();
        await refetchMetaAdsConnectionStatus();
      }
    } catch (err) {
      toast.update(toastId, err instanceof Error ? err.message : 'Failed to sync Meta Ads.', 'error');
    }
  }, [metaAdsCooldown, syncMetaAdsMutation, toast, queryClient, refetchMetaAdsSyncStatus, applyMetaCooldown]);

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Are you sure you want to delete this category?')) return;
    try {
      await deleteCategoryMutation.mutateAsync(id);
      toast.success('Category deleted successfully!');
    } catch (err) {
      console.error('Failed to delete category:', err);
      toast.error('Failed to delete category: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleAddPayment = async () => {
    if (!paymentForm.name.trim()) {
      toast.warning('Please enter a payment method name');
      return;
    }
    
    // Create new payment method object with temporary ID
    const newPaymentMethod = {
      id: crypto.randomUUID(),
      name: paymentForm.name,
      description: paymentForm.description || '',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    // Optimistically update React Query cache immediately
    const previousPaymentMethods = queryClient.getQueryData(['paymentMethods']);
    queryClient.setQueryData(['paymentMethods'], (old: any[] = []) => [...old, newPaymentMethod]);
    
    // Show toast immediately
    const toastId = toast.loading('Adding payment method...');
    
    // Reset form and close modal
    const formData = { ...paymentForm };
    setPaymentForm({ name: '', description: '' });
    setShowModal(null);
    
    try {
      // Save to database
      await createPaymentMutation.mutateAsync({
        name: formData.name,
        description: formData.description || undefined,
      });
      
      // Update toast to success
      toast.update(toastId, 'Payment method added successfully!', 'success');
    } catch (err) {
      console.error('Failed to add payment method:', err);
      // Rollback cache on error
      queryClient.setQueryData(['paymentMethods'], previousPaymentMethods);
      
      // Show error toast
      toast.update(toastId, 'Failed to add payment method: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
      
      // Reopen modal so user can try again
      setShowModal('payment');
      setPaymentForm(formData);
    }
  };

  const handleDeletePayment = async (id: string) => {
    if (!confirm('Are you sure you want to delete this payment method?')) return;
    try {
      await deletePaymentMutation.mutateAsync(id);
      toast.success('Payment method deleted successfully!');
    } catch (err) {
      console.error('Failed to delete payment method:', err);
      toast.error('Failed to delete payment method: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleAddUnit = async () => {
    if (!unitForm.name.trim() || !unitForm.shortName.trim()) {
      toast.warning('Please enter unit name and short name');
      return;
    }
    
    // Create new unit object with temporary ID
    const newUnit = {
      id: crypto.randomUUID(),
      name: unitForm.name,
      short_name: unitForm.shortName,
      description: unitForm.description || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    // Optimistically update React Query cache immediately
    const previousUnits = queryClient.getQueryData(['units']);
    queryClient.setQueryData(['units'], (old: any[] = []) => [...old, newUnit]);
    
    // Show toast immediately
    const toastId = toast.loading('Adding unit...');
    
    // Reset form and close modal
    const formData = { ...unitForm };
    setUnitForm({ name: '', shortName: '', description: '' });
    setShowModal(null);
    
    try {
      // Save to database
      await createUnitMutation.mutateAsync({
        name: formData.name,
        shortName: formData.shortName,
        description: formData.description || undefined,
      });
      
      // Update toast to success
      toast.update(toastId, 'Unit added successfully!', 'success');
    } catch (err) {
      console.error('Failed to add unit:', err);
      // Rollback cache on error
      queryClient.setQueryData(['units'], previousUnits);
      
      // Show error toast
      toast.update(toastId, 'Failed to add unit: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
      
      // Reopen modal so user can try again
      setShowModal('unit');
      setUnitForm(formData);
    }
  };

  const handleDeleteUnit = async (id: string) => {
    if (!confirm('Are you sure you want to delete this unit?')) return;
    try {
      await deleteUnitMutation.mutateAsync(id);
      toast.success('Unit deleted successfully!');
    } catch (err) {
      console.error('Failed to delete unit:', err);
      toast.error('Failed to delete unit: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const tabs = [
    canEditCompanySettings ? { id: 'company', label: 'Company', icon: ICONS.Dashboard } : null,
    canEditOrderInvoiceSettings ? { id: 'order', label: 'Order & Invoice', icon: ICONS.Sales } : null,
    canEditDefaults ? { id: 'defaults', label: 'Defaults', icon: ICONS.Settings } : null,
    canEditWalletSettings ? { id: 'wallet', label: 'Wallet', icon: ICONS.Payroll } : null,
    hasCapability('marketing') && canSyncAds ? { id: 'meta-ads', label: 'Meta Ads', icon: ICONS.Bell } : null,
    hasCapability('custom_roles') && canManagePermissions ? { id: 'permissions', label: 'Permissions', icon: ICONS.Users } : null,
    canEditCategories ? { id: 'categories', label: 'Categories', icon: ICONS.More } : null,
    canEditPaymentMethods ? { id: 'payments', label: 'Payment Methods', icon: ICONS.Banking } : null,
    hasCapability('courier_automation') && canEditCourierSettings ? { id: 'courier', label: 'Courier', icon: ICONS.Courier } : null,
  ].filter(Boolean) as { id: string; label: string; icon: React.ReactNode }[];
  const availableTabIds = tabs.map((tab) => tab.id).join('|');

  React.useEffect(() => {
    if (tabs.some((tab) => tab.id === activeTab)) {
      return;
    }

    setActiveTab('company');
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('tab');
    setSearchParams(nextParams, { replace: true });
  }, [activeTab, availableTabIds, searchParams, setSearchParams]);

  if (!user) {
    return <div className="p-8 text-center text-gray-500">Loading settings access...</div>;
  }

  if (!hasAdminAccess(user.role) && tabs.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Access Restricted</p>
          <h2 className="mt-3 text-2xl font-black text-gray-900">You don't have permission to access any settings.</h2>
          <p className="mt-2 text-sm font-medium text-gray-500">
            Contact your administrator to get the required permissions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <LoadingOverlay isLoading={loading} message="Loading settings..." />
      <div className="flex items-center justify-between">
        <div />
        <Button
          onClick={handleSave}
          variant="primary"
          size="md"
        >
          Save Changes
        </Button>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="w-full lg:w-64 space-y-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl font-medium transition-all ${
                activeTab === tab.id 
                  ? `${theme.colors.primary[600]} text-white shadow-sm border border-gray-100 ring-1 ring-[#ebf4ff]` 
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-0 bg-white p-8 rounded-xl border border-gray-100 shadow-sm min-h-[500px]">
          {activeTab === 'company' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Company Pages</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Add as many pages as you need. The page marked as global branding becomes the default for new orders.
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAddCompanyPage}
                  aria-label="Add company page"
                  title="Add company page"
                  className="h-10 w-10 justify-center px-0"
                >
                  {ICONS.Plus}
                </Button>
              </div>

              <div className="space-y-6">
                {companySettings.pages.map((page, index) => {
                  const isExpanded = expandedCompanyPages[page.id] ?? false;
                  return (
                    <div key={page.id} className="rounded-2xl border border-gray-100 bg-gray-50/60 shadow-sm">
                      <button
                        type="button"
                        onClick={() => setExpandedCompanyPages((current) => ({
                          ...current,
                          [page.id]: !current[page.id],
                        }))}
                        className="w-full px-6 py-5 flex items-center justify-between gap-4 text-left"
                      >
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Page {index + 1}</p>
                          <h4 className="mt-2 text-lg font-black text-gray-900">{page.name || `Page ${index + 1}`}</h4>
                          <p className="mt-1 text-sm text-gray-500 truncate">
                            {page.email || page.phone || page.address || 'Tap to view details.'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {page.isGlobalBranding ? (
                            <span className="rounded-full border border-[#c7dff5] bg-[#ebf4ff] px-3 py-1 text-xs font-black uppercase tracking-widest text-[#0f2f57]">
                              Global Branding
                            </span>
                          ) : null}
                          <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                            {ICONS.ChevronRight}
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-100 bg-white p-6 space-y-6">
                          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                            <div className="md:col-span-2 flex items-center gap-6 rounded-2xl border border-gray-100 bg-gray-50 p-6">
                              <div className="h-20 w-20 overflow-hidden rounded-xl border bg-gray-50">
                                {page.logo ? (
                                  <img src={page.logo} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[10px] font-black uppercase tracking-widest text-gray-300">
                                    No Logo
                                  </div>
                                )}
                              </div>
                              <div className="space-y-2">
                                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Logo</p>
                                <input
                                  type="file"
                                  id={`logo-input-${page.id}`}
                                  className="hidden"
                                  onChange={(event) => handleCompanyPageLogoUpload(page.id, event)}
                                />
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => document.getElementById(`logo-input-${page.id}`)?.click()}
                                >
                                  {page.logo ? 'Change Logo' : 'Upload Logo'}
                                </Button>
                              </div>
                            </div>

                            <div className="md:col-span-2 space-y-2">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Page Name</label>
                                  <input
                                    type="text"
                                    value={page.name}
                                    onChange={(event) => handleCompanyPageChange(page.id, 'name', event.target.value)}
                                    className="w-full rounded-xl border border-gray-100 bg-white px-4 py-3 transition-all focus:ring-2 focus:ring-[#3c5a82]"
                                  />
                                </div>
                                <button
                                  type="button"
                                  aria-label={`Remove page ${index + 1}`}
                                  title="Remove Page"
                                  onClick={() => handleRequestRemoveCompanyPage(page.id, page.name || `Page ${index + 1}`)}
                                  disabled={companySettings.pages.length === 1}
                                  className="inline-flex h-10 items-center justify-center rounded-full border border-red-100 px-4 text-sm font-medium text-red-500 transition-all hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-100 disabled:text-gray-300"
                                >
                                  Remove Page
                                </button>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Phone</label>
                              <input
                                type="text"
                                value={page.phone}
                                onChange={(event) => handleCompanyPageChange(page.id, 'phone', event.target.value)}
                                className="w-full rounded-xl border border-gray-100 bg-white px-4 py-3 transition-all focus:ring-2 focus:ring-[#3c5a82]"
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Email</label>
                              <input
                                type="email"
                                value={page.email}
                                onChange={(event) => handleCompanyPageChange(page.id, 'email', event.target.value)}
                                className="w-full rounded-xl border border-gray-100 bg-white px-4 py-3 transition-all focus:ring-2 focus:ring-[#3c5a82]"
                              />
                            </div>

                            <div className="md:col-span-2 space-y-2">
                              <label className="text-xs font-bold uppercase tracking-widest text-gray-400">Office Address</label>
                              <textarea
                                value={page.address}
                                onChange={(event) => handleCompanyPageChange(page.id, 'address', event.target.value)}
                                className="h-24 w-full rounded-xl border border-gray-100 bg-white px-4 py-3 transition-all focus:ring-2 focus:ring-[#3c5a82]"
                              />
                            </div>

                            <div className="md:col-span-2">
                              <label className="flex cursor-pointer items-center gap-3 rounded-full border border-[#c7dff5] bg-[#ebf4ff] px-4 py-3 text-sm font-black uppercase tracking-widest text-[#0f2f57]">
                                <input
                                  type="checkbox"
                                  checked={page.isGlobalBranding}
                                  onChange={() => handleSetGlobalCompanyPage(page.id)}
                                  className="h-4 w-4 rounded border-gray-300 text-[#0f2f57] focus:ring-[#0f2f57]"
                                />
                                Global Branding
                              </label>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'order' && (
            <div className="space-y-10 animate-in fade-in duration-300">
              <section className="space-y-6">
                <h3 className="text-xl font-bold text-gray-800 border-b pb-4">Order Logic</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Order Prefix</label>
                    <input 
                      type="text" 
                      value={orderSettings.prefix} 
                      onChange={e => setOrderSettings({...orderSettings, prefix: e.target.value})}
                      className={`w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl font-mono`} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Next Number</label>
                    <NumericInput 
                      value={orderSettings.nextNumber} 
                      onChange={value => setOrderSettings({...orderSettings, nextNumber: Math.max(0, value)})}
                      className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3" 
                      allowDecimals={false}
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <h3 className="text-xl font-bold text-gray-800 border-b pb-4">Invoice Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-1 space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Invoice Title</label>
                    <input 
                      type="text" 
                      value={invoiceSettings.title} 
                      onChange={e => setInvoiceSettings({...invoiceSettings, title: e.target.value})}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Logo Width (px)</label>
                    <NumericInput 
                      value={invoiceSettings.logoWidth} 
                      onChange={value => setInvoiceSettings({...invoiceSettings, logoWidth: Math.max(0, value)})}
                      className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3" 
                      allowDecimals={false}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Logo Height (px)</label>
                    <NumericInput 
                      value={invoiceSettings.logoHeight} 
                      onChange={value => setInvoiceSettings({...invoiceSettings, logoHeight: Math.max(0, value)})}
                      className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3" 
                      allowDecimals={false}
                    />
                  </div>
                  <div className="md:col-span-3 space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Invoice Footer</label>
                    <textarea 
                      value={invoiceSettings.footer} 
                      onChange={e => setInvoiceSettings({...invoiceSettings, footer: e.target.value})}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl h-24" 
                    />
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'defaults' && (
            <div className="space-y-10 animate-in fade-in duration-300">
              <h3 className="text-xl font-bold text-gray-800 border-b pb-4">System Defaults</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Account</label>
                  <select 
                    value={systemDefaults.defaultAccountId}
                    onChange={e => setSystemDefaults({...systemDefaults, defaultAccountId: e.target.value})}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                  >
                    <option value="">Select an account...</option>
                    {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Payment Method</label>
                  <select 
                    value={systemDefaults.defaultPaymentMethod}
                    onChange={e => setSystemDefaults({...systemDefaults, defaultPaymentMethod: e.target.value})}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                  >
                    <option value="">Select a payment method...</option>
                    {paymentMethods.map(pm => <option key={pm.id} value={pm.name}>{pm.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Income Category</label>
                  <select 
                    value={systemDefaults.incomeCategoryId}
                    onChange={e => setSystemDefaults({...systemDefaults, incomeCategoryId: e.target.value})}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                  >
                    <option value="">Select a category...</option>
                    {categories.filter(c => c.type === 'Income').map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Theme Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={systemDefaults.themeColor}
                      onChange={e => setSystemDefaults({...systemDefaults, themeColor: e.target.value})}
                      className="w-28 h-12 p-0 border border-gray-100 rounded-2xl cursor-pointer"
                    />
                    <span className="text-sm font-medium text-gray-600">{systemDefaults.themeColor}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Records Per Page</label>
                  <NumericInput 
                    value={systemDefaults.recordsPerPage} 
                    onChange={value => setSystemDefaults({...systemDefaults, recordsPerPage: Math.max(1, value)})}
                    className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3"
                    allowDecimals={false}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Expense Category</label>
                  <select 
                    value={systemDefaults.expenseCategoryId}
                    onChange={e => setSystemDefaults({...systemDefaults, expenseCategoryId: e.target.value})}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                  >
                    <option value="">Select a category...</option>
                    {categories.filter(c => c.type === 'Expense').map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Max Transaction Amount Without Approval</label>
                  <NumericInput
                    value={systemDefaults.maxTransactionAmount ?? 0}
                    onChange={value =>
                      setSystemDefaults({
                        ...systemDefaults,
                        maxTransactionAmount: Math.max(0, value),
                      })
                    }
                    className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3"
                    allowDecimals={true}
                    decimalPlaces={2}
                  />
                  <p className="text-xs font-medium text-gray-400">
                    Transactions above this amount will stay pending until an admin accepts or declines them.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'payroll' && (
            <div className="space-y-10 animate-in fade-in duration-300">
              <section className="space-y-6">
                <div className="border-b border-gray-100 pb-4">
                  <h3 className="text-xl font-bold text-gray-800">Wallet Settings</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Unit Amount (৳)</label>
                    <NumericInput
                      value={walletSettings.unitAmount}
                      onChange={(value) =>
                        setWalletSettings((current) => ({
                          ...current,
                          unitAmount: Math.max(0, value),
                        }))
                      }
                      className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3"
                      allowDecimals={false}
                    />
                    <p className="text-xs font-medium text-gray-400">
                      Employees earn this amount only when their order matches one of the payable statuses below.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#d6e3f0] bg-[#f8fbff] px-5 py-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Current Preview</p>
                    <p className="mt-3 text-lg font-black text-gray-900">{formatCurrency(walletSettings.unitAmount)}</p>
                    <p className="mt-2 text-sm font-medium text-gray-500">
                      Applied to each new employee-created order as a wallet credit.
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <div className="border-b border-gray-100 pb-4">
                  <h3 className="text-xl font-bold text-gray-800">Counted Order Statuses</h3>
                  <p className="mt-2 text-sm text-gray-500">
                    Select the exact order statuses that should be included in payroll calculations.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {PAYROLL_STATUS_OPTIONS.map((status) => {
                    const checked = payrollSettings.countedStatuses.includes(status);
                    return (
                      <button
                        type="button"
                        key={status}
                        onClick={() => togglePayrollStatus(status)}
                        className={`flex items-start gap-4 rounded-2xl border px-4 py-4 text-left transition-all ${
                          checked
                            ? 'border-[#c7dff5] bg-[#f8fbff] shadow-sm'
                            : 'border-gray-100 bg-gray-50/70 hover:border-gray-200 hover:bg-white'
                        }`}
                      >
                        <div
                          className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-md border text-[11px] ${
                            checked
                              ? 'border-[#0f2f57] bg-[#0f2f57] text-white'
                              : 'border-gray-300 bg-white text-transparent'
                          }`}
                        >
                          âœ“
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-black text-gray-900">{status}</p>
                          <p className="mt-1 text-xs font-medium text-gray-500">
                            {checked ? 'Included in payroll calculations.' : 'Excluded from payroll calculations.'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-5">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Selected Statuses</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {payrollSettings.countedStatuses.map((status) => (
                      <span
                        key={status}
                        className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] ${theme.colors.primary[50]} ${theme.colors.primary.text}`}
                      >
                        {status}
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'wallet' && (
            <div className="space-y-10 animate-in fade-in duration-300">
              <section className="space-y-6">
                <div className="border-b border-gray-100 pb-4">
                  <h3 className="text-xl font-bold text-gray-800">Wallet Settings</h3>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Unit Amount (৳)</label>
                    <NumericInput
                      value={walletSettings.unitAmount}
                      onChange={(value) =>
                        setWalletSettings((current) => ({
                          ...current,
                          unitAmount: Math.max(0, value),
                        }))
                      }
                      className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3"
                      allowDecimals={false}
                    />
                    <p className="text-xs font-medium text-gray-400">
                      Employees earn this amount every time they create a new order.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#d6e3f0] bg-[#f8fbff] px-5 py-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Current Preview</p>
                    <p className="mt-3 text-lg font-black text-gray-900">{formatCurrency(walletSettings.unitAmount)}</p>
                    <p className="mt-2 text-sm font-medium text-gray-500">
                      Applied to employee orders that are currently in the selected payable statuses.
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="border-b border-gray-100 pb-4">
                    <h3 className="text-xl font-bold text-gray-800">Payable Orders</h3>
                    <p className="mt-2 text-sm text-gray-500">
                      Choose which order statuses should add wallet credit to the corresponding employee. Multiple statuses can be selected at the same time.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {Object.values(OrderStatus).map((status) => {
                      const checked = walletSettings.countedStatuses.includes(status);

                      return (
                        <label
                          key={status}
                          className={`flex cursor-pointer items-start gap-4 rounded-2xl border px-4 py-4 transition-all ${
                            checked
                              ? 'border-[#c7dff5] bg-[#f8fbff] shadow-sm'
                              : 'border-gray-100 bg-gray-50/70 hover:border-gray-200 hover:bg-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleWalletStatus(status)}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-[#0f2f57] focus:ring-[#3c5a82]"
                          />
                          <div className="flex-1">
                            <p className="text-sm font-black text-gray-900">{status}</p>
                            <p className="mt-1 text-xs font-medium text-gray-500">
                              {checked ? 'Orders in this status will credit the employee wallet.' : 'Orders in this status will not credit the employee wallet.'}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Selected Statuses</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {walletSettings.countedStatuses.length > 0 ? (
                        walletSettings.countedStatuses.map((status) => (
                          <span
                            key={status}
                            className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] ${theme.colors.primary[50]} ${theme.colors.primary.text}`}
                          >
                            {status}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm font-medium text-gray-500">
                          No payable statuses selected. No wallet credit will be added until at least one status is checked.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'meta-ads' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <section className="space-y-6">
                <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">Meta Ads</h3>
                    <p className="mt-2 max-w-3xl text-sm text-gray-500">
                      Connect Meta to import Businesses, Ad Accounts, Campaigns, Ad Sets, Ads, creatives, and performance metrics.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button type="button" onClick={handleConnectMetaAds} loading={beginMetaAdsOAuthMutation.isPending} icon={ICONS.PlusCircle}>
                      Connect Meta
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleSyncMetaAds}
                      loading={syncMetaAdsMutation.isPending}
                      disabled={!metaAdsStatus?.connections?.length || metaAdsCooldown > 0}
                      icon={ICONS.Clock}
                    >
                      {metaAdsCooldown > 0 ? `Cooldown ${Math.floor(metaAdsCooldown / 60)}:${String(metaAdsCooldown % 60).padStart(2, '0')} ` : 'Sync Now'}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Businesses</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">{metaAdsStatus?.summary?.totalBusinesses ?? 0}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Ad Accounts</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">{metaAdsStatus?.summary?.totalAdAccounts ?? 0}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Ads</p>
                    <p className="mt-2 text-2xl font-black text-gray-900">{metaAdsStatus?.summary?.totalAds ?? 0}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h4 className="text-base font-black text-gray-900">Meta App Settings</h4>
                      <p className="mt-1 text-sm text-gray-500">Store the Meta app credentials in the database so admins can manage them from Settings.</p>
                    </div>
                    <Button type="button" onClick={handleSaveMetaAdsSettings} loading={updateMetaAdsSettingsMutation.isPending} icon={ICONS.Check}>
                      Save Meta App
                    </Button>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>App ID</span>
                      <input
                        value={metaAdsSettings.appId}
                        onChange={(event) => setMetaAdsSettings((current) => ({ ...current, appId: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                        placeholder="Enter Meta App ID"
                      />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>App Secret</span>
                      <input
                        type="password"
                        value={metaAdsSettings.appSecret}
                        onChange={(event) => setMetaAdsSettings((current) => ({ ...current, appSecret: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                        placeholder="Enter Meta App Secret"
                      />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>Redirect URI</span>
                      <input
                        value={metaAdsSettings.redirectUri}
                        onChange={(event) => setMetaAdsSettings((current) => ({ ...current, redirectUri: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                        placeholder="https://your-domain/api/index.php?action=metaAdsOAuthCallback"
                      />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>Login Config ID</span>
                      <input
                        value={metaAdsSettings.loginConfigId}
                        onChange={(event) => setMetaAdsSettings((current) => ({ ...current, loginConfigId: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                        placeholder="Optional"
                      />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>Graph Version</span>
                      <input
                        value={metaAdsSettings.graphVersion}
                        onChange={(event) => setMetaAdsSettings((current) => ({ ...current, graphVersion: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                        placeholder="v25.0"
                      />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-gray-700 md:col-span-2">
                      <span>OAuth Scopes</span>
                      <input
                        value={metaAdsSettings.oauthScopes}
                        onChange={(event) => setMetaAdsSettings((current) => ({ ...current, oauthScopes: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                        placeholder="public_profile,ads_read,business_management"
                      />
                    </label>
                  </div>
                </div>


                <div className="rounded-xl border border-gray-100 bg-white p-4">
                  <h4 className="text-base font-black text-gray-900">Ad Currency</h4>
                  <p className="mt-1 text-sm text-gray-500">Currency used by your Meta Ad Account. Amounts will be displayed in this currency across the dashboard.</p>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>Ad Currency</span>
                      <select
                        value={metaAdsSettings.displayCurrencyCode}
                        onChange={(event) => setMetaAdsSettings((current) => ({ ...current, displayCurrencyCode: event.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                      >
                        {['BDT','USD','EUR','GBP','INR','SAR','AED','MYR','SGD','AUD','CAD'].map((code) => (
                          <option key={code} value={code}>{code}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>Exchange Rate � 1 {metaAdsSettings.displayCurrencyCode} = ? ৳</span>
                      <NumericInput
                        value={metaAdsSettings.displayCurrencyRateToBdt ?? ''}
                        onChange={(val) => setMetaAdsSettings((current) => ({ ...current, displayCurrencyRateToBdt: val || null }))}
                        placeholder={metaAdsSettings.displayCurrencyCode === 'BDT' ? 'Not needed for ৳' : 'e.g. 120'}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                      />
                      <span className="text-xs text-gray-400">Used to show ৳ equivalents in tooltips</span>
                    </label>
                  </div>
                </div>

                <div className={`rounded-xl border p-4 ${metaAdsStatus?.configured ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50'}`}>
                  <p className={`text-sm font-bold ${metaAdsStatus?.configured ? 'text-emerald-700' : 'text-amber-800'}`}>
                    {metaAdsStatus?.configured ? 'Meta OAuth is configured.' : 'Meta OAuth needs a Meta App ID and App Secret.'}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-gray-600">
                    {metaAdsStatus == null ? (
                      'Loading...'
                    ) : metaAdsStatus.redirectUri ? (
                      <span className="break-all">Configured redirect URI: {metaAdsStatus.redirectUri}</span>
                    ) : (
                      'No redirect URI is configured. Save one above or leave blank to let the API infer the runtime callback URL.'
                    )}
                  </p>
                </div>

                <div className="space-y-3">
                  {(metaAdsStatus?.connections || []).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-6 text-sm font-semibold text-gray-500">
                      No Meta account is connected yet.
                    </div>
                  ) : (
                    metaAdsStatus.connections.map((connection: any) => (
                      <div key={connection.id} className="rounded-xl border border-gray-100 bg-white p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-sm font-black text-gray-900">{connection.metaUserName || connection.metaUserId || 'Meta Account'}</p>
                            <p className="mt-1 text-xs font-semibold text-gray-500">
                              Last synced: {connection.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString('en-BD') : 'Not synced yet'}
                            </p>
                          </div>
                          <span className={`inline-flex max-w-fit rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${connection.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                            {connection.isActive ? 'Connected' : 'Inactive'}
                          </span>
                        </div>
                        {connection.syncError && (
                          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{connection.syncError}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'permissions' && (
            <PermissionsSettingsPanel
              value={permissionsSettings}
              onChange={setPermissionsSettings}
            />
          )}

          {activeTab === 'categories' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b pb-4">
                <h3 className="text-xl font-bold text-gray-800">Categories</h3>
                <Button
                  onClick={() => setShowModal('category')}
                  variant="primary"
                  size="md"
                >
                  {ICONS.Plus} Add
                </Button>
              </div>
              {loadingCategories ? (
                <div className="text-center py-8 text-gray-500">Loading categories...</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {categories.map(cat => (
                    <div key={cat.id} className="flex items-center gap-4 p-4 border rounded-lg bg-gray-50/50 hover:shadow-sm transition-all">
                      <div className="w-4 h-4 rounded-full" style={{ backgroundColor: cat.color }}></div>
                      <div className="flex-1">
                        <p className="font-bold text-gray-800">
                          {cat.name}
                          {cat.isSystem && !['income_sales', 'expense_purchases', 'expense_shipping'].includes(cat.id) && (
                            <span className="ml-3 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-black uppercase tracking-widest text-gray-500">
                              System
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{cat.type}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteCategory(cat.id)}
                        disabled={!!cat.isSystem}
                        title={cat.isSystem ? 'System categories cannot be deleted' : 'Delete'}
                        className={`px-2 ${cat.isSystem ? 'text-gray-300 cursor-not-allowed' : 'text-red-500 hover:text-red-700'}`}
                      >
                        {ICONS.Delete}
                      </button>
                    </div>
                  ))}
                  {categories.length === 0 && (
                    <div className="col-span-2 text-center py-8 text-gray-500">
                      No categories yet. Click "Add Category" to create one.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'payments' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b pb-4">
                <h3 className="text-xl font-bold text-gray-800">Payment Methods</h3>
                <Button
                  onClick={() => setShowModal('payment')}
                  variant="primary"
                  size="md"
                >
                  {ICONS.Plus} Add
                </Button>
              </div>
              {loadingPaymentMethods ? (
                <div className="text-center py-8 text-gray-500">Loading payment methods...</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {paymentMethods.map(pm => (
                    <div key={pm.id} className="p-4 border rounded-lg bg-gray-50/50 hover:shadow-sm transition-all flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-bold text-gray-800">{pm.name}</p>
                        <p className="text-xs text-gray-400 mt-1">{pm.description || 'No description'}</p>
                      </div>
                      <button
                        onClick={() => handleDeletePayment(pm.id)}
                        className="text-red-500 hover:text-red-700 px-2"
                      >
                        {ICONS.Delete}
                      </button>
                    </div>
                  ))}
                  {paymentMethods.length === 0 && (
                    <div className="col-span-2 text-center py-8 text-gray-500">
                      No payment methods yet. Click "Add Method" to create one.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'courier' && (
            <div className="space-y-10 animate-in fade-in duration-300">
              <section className="space-y-6">
                <h3 className="text-xl font-bold text-gray-800 border-b pb-4 flex items-center gap-2">
                  <img src="/uploads/steadfast.png" alt="Steadfast" className="w-6 h-6 rounded-full" />
                  <span className="">Steadfast</span> Secrets
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Base URL</label>
                    <input 
                      type="text" 
                      value={courierSettings.steadfast.baseUrl}
                      onChange={e => setCourierSettings({...courierSettings, steadfast: {...courierSettings.steadfast, baseUrl: e.target.value}})}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl" 
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">API Key</label>
                      <input 
                        type="text" 
                        value={courierSettings.steadfast.apiKey}
                        onChange={e => setCourierSettings({...courierSettings, steadfast: {...courierSettings.steadfast, apiKey: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Secret Key</label>
                      <input 
                        type="text" 
                        value={courierSettings.steadfast.secretKey}
                        onChange={e => setCourierSettings({...courierSettings, steadfast: {...courierSettings.steadfast, secretKey: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl" 
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <h3 className="text-xl font-bold text-gray-800 border-b pb-4 flex items-center gap-2">
                  <img src="/uploads/carrybee.png" alt="CarryBee" className="w-6 h-6 rounded-full" />
                  <span className="">CarryBee</span> Secrets
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Base URL</label>
                    <input 
                      type="text" 
                      value={courierSettings.carryBee.baseUrl}
                      onChange={e => setCourierSettings({...courierSettings, carryBee: {...courierSettings.carryBee, baseUrl: e.target.value}})}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl" 
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Client ID</label>
                      <input 
                        type="text" 
                        value={courierSettings.carryBee.clientId}
                        onChange={e => setCourierSettings({...courierSettings, carryBee: {...courierSettings.carryBee, clientId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Client Secret</label>
                      <input 
                        type="text" 
                        value={courierSettings.carryBee.clientSecret}
                        onChange={e => setCourierSettings({...courierSettings, carryBee: {...courierSettings.carryBee, clientSecret: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl" 
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Client Context</label>
                      <input 
                        type="text" 
                        value={courierSettings.carryBee.clientContext}
                        onChange={e => setCourierSettings({...courierSettings, carryBee: {...courierSettings.carryBee, clientContext: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl" 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Store ID</label>
                      <select 
                        value={courierSettings.carryBee.storeId}
                        onChange={e => setCourierSettings({...courierSettings, carryBee: {...courierSettings.carryBee, storeId: e.target.value}})}
                        disabled={loadingCarryBeeStores || carryBeeStores.length === 0}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">
                          {loadingCarryBeeStores ? 'Loading stores...' : carryBeeStores.length === 0 ? 'Fill CarryBee credentials first' : 'Select Store'}
                        </option>
                        {carryBeeStores.map(store => (
                          <option key={store.id} value={store.id}>{store.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <h3 className="text-xl font-bold text-gray-800 border-b pb-4 flex items-center gap-2">
                  <img src="/uploads/paperfly.png" alt="Paperfly" className="w-6 h-6 rounded-full" />
                  <span className="">Paperfly</span> Secrets
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Base URL</label>
                    <input
                      type="text"
                      value={courierSettings.paperfly.baseUrl}
                      onChange={e => setCourierSettings({ ...courierSettings, paperfly: { ...courierSettings.paperfly, baseUrl: e.target.value } })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Username</label>
                      <input
                        type="text"
                        value={courierSettings.paperfly.username}
                        onChange={e => setCourierSettings({ ...courierSettings, paperfly: { ...courierSettings.paperfly, username: e.target.value } })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Password</label>
                      <input
                        type="text"
                        value={courierSettings.paperfly.password}
                        onChange={e => setCourierSettings({ ...courierSettings, paperfly: { ...courierSettings.paperfly, password: e.target.value } })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Paperfly Key</label>
                      <input
                        type="text"
                        value={courierSettings.paperfly.paperflyKey}
                        onChange={e => setCourierSettings({ ...courierSettings, paperfly: { ...courierSettings.paperfly, paperflyKey: e.target.value } })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Shop Name</label>
                      <input
                        type="text"
                        value={courierSettings.paperfly.defaultShopName}
                        onChange={e => setCourierSettings({ ...courierSettings, paperfly: { ...courierSettings.paperfly, defaultShopName: e.target.value } })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Max Weight (kg)</label>
                    <NumericInput
                      value={courierSettings.paperfly.maxWeightKg ?? 0.3}
                      onChange={value => setCourierSettings({
                        ...courierSettings,
                        paperfly: {
                          ...courierSettings.paperfly,
                          maxWeightKg: Math.max(0, value),
                        }
                      })}
                      className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3"
                      allowDecimals={true}
                      decimalPlaces={2}
                    />
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'fraud-checker' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <section className="space-y-6">
                <div className="border-b border-gray-100 pb-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-xl font-bold text-gray-800">Fraud Checker</h3>
                    <div className="group relative">
                      <button
                        type="button"
                        title="Uses https://app.bdcourier.com/"
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-100 bg-white text-gray-400 transition-all hover:bg-gray-50 hover:text-[#0f2f57]"
                      >
                        {ICONS.Info}
                      </button>
                      <div className="pointer-events-none absolute left-full top-1/2 z-10 ml-3 w-64 -translate-y-1/2 rounded-2xl border border-gray-100 bg-white px-3 py-2 text-xs font-medium text-gray-600 shadow-xl opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                        Uses <span className="font-black text-gray-900">https://app.bdcourier.com/</span>
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-gray-500">
                    The base URL is set to <a href="https://app.bdcourier.com/" className="font-black text-gray-900">https://api.bdcourier.com/courier-check</a> by default.
                  </p>
                </div>

                <div className="grid gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">API Key</label>
                    <input
                      type="text"
                      value={courierSettings.fraudChecker.apiKey}
                      onChange={(event) =>
                        setCourierSettings((current) => ({
                          ...current,
                          fraudChecker: {
                            ...current.fraudChecker,
                            apiKey: event.target.value,
                          },
                        }))
                      }
                      placeholder="Paste your BDCourier API key"
                      className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium transition-all focus:ring-2 focus:ring-[#3c5a82]"
                    />
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {pagePendingRemoval && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={closePageRemovalModal}></div>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 p-8 space-y-6">
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">Critical Action</p>
              <h3 className="text-xl font-bold text-gray-900">Delete Company Page</h3>
              <p className="text-sm text-gray-500">
                Type <span className="font-black text-gray-900">{pagePendingRemoval.pageName}</span> exactly to confirm deletion of this page.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              This permanently removes the page from the current settings draft, including its branding details.
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Confirm Page Name</label>
              <input
                type="text"
                value={pageRemovalConfirmText}
                onChange={(event) => {
                  setPageRemovalConfirmText(event.target.value);
                  setPageRemovalError('');
                }}
                placeholder={pagePendingRemoval.pageName}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
              />
            </div>

            {pageRemovalError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                {pageRemovalError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button onClick={closePageRemovalModal} variant="ghost" className="flex-1">Cancel</Button>
              <Button onClick={confirmRemoveCompanyPage} variant="danger" size="md" className="flex-1">Delete Page</Button>
            </div>
          </div>
        </div>
      )}

      {showModal === 'category' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setShowModal(null)}></div>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 p-8 space-y-6">
            <h3 className="text-xl font-bold text-gray-900">Add Category</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Name</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
                  value={categoryForm.name}
                  onChange={e => setCategoryForm({...categoryForm, name: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Type</label>
                <select 
                  className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
                  value={categoryForm.type}
                  onChange={e => setCategoryForm({...categoryForm, type: e.target.value as any})}
                >
                  <option value="Income">Income</option>
                  <option value="Expense">Expense</option>
                  <option value="Product">Product</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Color</label>
                <input 
                  type="color" 
                  className="w-full h-12 bg-gray-50 border rounded-xl cursor-pointer"
                  value={categoryForm.color}
                  onChange={e => setCategoryForm({...categoryForm, color: e.target.value})}
                />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <Button onClick={() => setShowModal(null)} variant="ghost" className="flex-1">Cancel</Button>
              <Button onClick={handleAddCategory} variant="primary" size="md" className="flex-1">Add Category</Button>
            </div>
          </div>
        </div>
      )}

      {showModal === 'payment' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setShowModal(null)}></div>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 p-8 space-y-6">
            <h3 className="text-xl font-bold text-gray-900">Add Payment Method</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Method Name</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
                  value={paymentForm.name}
                  onChange={e => setPaymentForm({...paymentForm, name: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Description</label>
                <textarea 
                  className="w-full px-4 py-3 bg-gray-50 border rounded-xl h-24"
                  value={paymentForm.description}
                  onChange={e => setPaymentForm({...paymentForm, description: e.target.value})}
                />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <Button onClick={() => setShowModal(null)} variant="ghost" className="flex-1">Cancel</Button>
              <Button onClick={handleAddPayment} variant="primary" size="md" className="flex-1">Add Method</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;