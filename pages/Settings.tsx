import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { db, saveDb } from '../db';
import { ICONS, formatCurrency } from '../constants';
import { Button, DashboardSettingsPanel, PermissionsSettingsPanel, NumericInput } from '../components';
import { theme } from '../theme';
import { OrderStatus, ORDER_STATUS_VALUES, hasAdminAccess, type BeSmartSettings, type CompanyPage, type CourierSettings, type DashboardSettings, type MetaAdsSettings, type PermissionsSettings, type Settings, type VoiceSurveySettings } from '../types';
import {
  useCategories, usePaymentMethods, useUnits,
  useCompanySettings, useOrderSettings, useInvoiceSettings,
  useSystemDefaults, useCourierSettings, useAccounts, useProducts, useWalletSettings, usePermissionsSettings, useDashboardSettings, useMetaAdsConnectionStatus, useMetaAdsSettings, useMetaAdsSyncStatus,
  useVoiceSurveySettings, useBeSmartSettings
} from '../src/hooks/useQueries';
import {
  useCreateCategory, useDeleteCategory,
  useCreatePaymentMethod, useDeletePaymentMethod,
  useCreateUnit, useDeleteUnit,
  useBatchUpdateSettings,
  useUpdatePermissionsSettings,
  useUpdateDashboardSettings,
  useUpdateSystemDefaults,
  useBeginMetaAdsOAuth,
  useSyncMetaAds,
  useUpdateMetaAdsSettings,
  useUpdateVoiceSurveySettings, useUpdateBeSmartSettings
} from '../src/hooks/useMutations';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { LoadingOverlay } from '../components';
import { backfillOrderCogsExpenses, fetchCarryBeeStores, fetchOrderCogsBackfillStatus, type OrderCogsBackfillStatus } from '../src/services/supabaseQueries';
import { compressImage, formatDateTime } from '../utils';
import { normalizeCompanyPage, normalizeCompanySettings } from '../src/utils/companyPages';
import { clonePermissionsSettings, DEFAULT_ROLE_PERMISSION_SETTINGS } from '../src/utils/permissions';
import { EMPLOYEE_DEFAULT_DASHBOARD_ID, cloneDashboardSettings, dashboardHasScope, normalizeDashboardSettings } from '../src/dashboardConfig';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import WhatsAppSettingsPanel from '../components/WhatsAppSettingsPanel';
import MessengerSettingsPanel from '../components/MessengerSettingsPanel';
import WooCommerceSettingsPanel from '../components/WooCommerceSettingsPanel';
import ShopifySettingsPanel from '../components/ShopifySettingsPanel';
import DataManagementSettingsPanel from '../components/DataManagementSettingsPanel';
import { writeSystemDefaultsCache } from '../src/utils/startupCache';
import { useAutoSave } from '../src/hooks/useAutoSave';

type SystemDefaultField = keyof Settings['defaults'];

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
  const { hasCapability, hasSubCapability, capabilities } = useCapabilities(Boolean(user));
  const canUseSteadfast = hasSubCapability('steadfast_courier');
  const canUseCarryBee = hasSubCapability('carrybee_courier');
  const canUsePaperfly = hasSubCapability('paperfly_courier');
  const canUsePathao = hasSubCapability('pathao_courier');
  const canUseAccounts = hasSubCapability('accounts');
  const canUsePayroll = hasSubCapability('payroll');
  const canUsePurchasePriceCogs = !hasCapability('purchases') || user?.role === 'Developer';

  // Query data from React Query hooks
  const { data: companySettingsData, isPending: companyLoading } = useCompanySettings();
  const { data: orderSettingsData, isPending: orderLoading } = useOrderSettings();
  const { data: invoiceSettingsData, isPending: invoiceLoading } = useInvoiceSettings();
  const { data: systemDefaultsData, isPending: defaultsLoading } = useSystemDefaults();
  const { data: courierSettingsData, isPending: courierLoading } = useCourierSettings();
  const { data: walletSettingsData, isPending: walletPending } = useWalletSettings({ enabled: canUsePayroll });
  const walletLoading = canUsePayroll && walletPending;
  const { data: permissionsSettingsData, isPending: permissionsLoading } = usePermissionsSettings();
  const { data: dashboardSettingsData, isPending: dashboardSettingsLoading } = useDashboardSettings(hasAdminAccess(user?.role));
  const { data: metaAdsStatus, isPending: metaAdsLoading, refetch: refetchMetaAdsConnectionStatus } = useMetaAdsConnectionStatus(activeTab === 'meta-ads');
  const { data: metaAdsSettingsData, isPending: metaAdsSettingsLoading } = useMetaAdsSettings(activeTab === 'meta-ads');
  const { data: metaAdsSyncStatus, refetch: refetchMetaAdsSyncStatus } = useMetaAdsSyncStatus(activeTab === 'meta-ads');
  const { data: voiceSurveySettingsData, isPending: voiceSurveyLoading } = useVoiceSurveySettings(activeTab === 'voice-survey');
  const { data: beSmartSettingsData, isPending: beSmartLoading } = useBeSmartSettings(Boolean(capabilities.be_smart));
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
  const { data: accounts = [] } = useAccounts({ enabled: canUseAccounts });
  
  // Mutations
  const createCategoryMutation = useCreateCategory();
  const deleteCategoryMutation = useDeleteCategory();
  const createPaymentMutation = useCreatePaymentMethod();
  const deletePaymentMutation = useDeletePaymentMethod();
  const createUnitMutation = useCreateUnit();
  const deleteUnitMutation = useDeleteUnit();
  const batchUpdateMutation = useBatchUpdateSettings();
  const updatePermissionsSettingsMutation = useUpdatePermissionsSettings();
  const updateDashboardSettingsMutation = useUpdateDashboardSettings();
  const updateSystemDefaultsMutation = useUpdateSystemDefaults();
  const beginMetaAdsOAuthMutation = useBeginMetaAdsOAuth();
  const updateMetaAdsSettingsMutation = useUpdateMetaAdsSettings();
  const updateVoiceSurveySettingsMutation = useUpdateVoiceSurveySettings();
  const updateBeSmartSettingsMutation = useUpdateBeSmartSettings();
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
    automaticallyDeductShippingCosts: false,
    automaticallyMarkPaidAfterDelivery: false,
    steadfast: { baseUrl: '', apiKey: '', secretKey: '', invoice: '', defaultAccountId: '', defaultExpenseCategoryId: '', defaultIncomeCategoryId: '', defaultPaymentMethod: '' },
    carryBee: { baseUrl: '', clientId: '', clientSecret: '', clientContext: '', storeId: '', webhookSignature: '', webhookHeader: 'X-Carrybee-Webhook-Signature', webhookIntegrationHeader: 'X-CB-Webhook-Integration-Header', webhookIntegrationValue: '40489fe0-9386-4fc9-8e92-2b2fcb9d451c', defaultAccountId: '', defaultExpenseCategoryId: '', defaultIncomeCategoryId: '', defaultPaymentMethod: '' },
    paperfly: { baseUrl: '', username: '', password: '', paperflyKey: '', defaultShopName: '', maxWeightKg: 0.3, webhookSecret: '', defaultAccountId: '', defaultExpenseCategoryId: '', defaultIncomeCategoryId: '', defaultPaymentMethod: '' },
    pathao: { baseUrl: '', clientId: '', clientSecret: '', username: '', password: '', storeId: '', defaultQuantity: 1, defaultWeight: 1.0, defaultDeliveryType: 48, defaultItemType: 2, accessToken: '', refreshToken: '', tokenExpiresAt: '', webhookHeader: 'X-MamePilot-Webhook-Secret', webhookSecret: '', merchantWebhookSecret: '', defaultAccountId: '', defaultExpenseCategoryId: '', defaultIncomeCategoryId: '', defaultPaymentMethod: '' },
    fraudChecker: { apiKey: '' },
  });
  const courierWebhookEndpoint = (provider: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/api/courier-webhook.php?provider=${provider}`;
  };
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
    productSelectionMode: 'simple',
    calculateCogsFromPurchasePrice: false,
  });
  const [cogsBackfillStatus, setCogsBackfillStatus] = useState<OrderCogsBackfillStatus | null>(null);
  const [cogsBackfillRunning, setCogsBackfillRunning] = useState(false);
  const systemDefaultsDirtyFieldsRef = useRef<Set<SystemDefaultField>>(new Set());
  const [beSmartSettings, setBeSmartSettings] = useState<BeSmartSettings>({ smartCustomerAdding: false, smartVendorAdding: false, smartOrderCustomerSelection: false, smartBillVendorSelection: false });
  const [permissionsSettings, setPermissionsSettings] = useState<PermissionsSettings>(() =>
    clonePermissionsSettings(DEFAULT_ROLE_PERMISSION_SETTINGS),
  );
  const permissionsDirtyRef = useRef(false);
  const [permissionsDirty, setPermissionsDirty] = useState(false);
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings>(() => normalizeDashboardSettings());
  const dashboardDirtyRef = useRef(false);
  const [dashboardDirty, setDashboardDirty] = useState(false);
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(10);
  const lowStockThresholdDirtyRef = useRef(false);
  const [lowStockThresholdDirty, setLowStockThresholdDirty] = useState(false);
  const [metaAdsSettings, setMetaAdsSettings] = useState<MetaAdsSettings>({
    appId: '',
    appSecret: '',
    redirectUri: '',
    loginConfigId: '',
    graphVersion: 'v25.0',
    oauthScopes: 'public_profile,ads_read,business_management',
    displayCurrencyCode: 'BDT',
    displayCurrencyRateToBdt: null,
    exchangeRateMode: 'fixed',
    vatPercentage: null,
    realtimeRateCache: null,
    realtimeRateUpdatedAt: null,
  });
  const [voiceSurveySettings, setVoiceSurveySettings] = useState<VoiceSurveySettings>({
    enabled: false,
    delayMinutes: 5,
    missedCallRetryMinutes: 30,
    missedCallRetryCount: 3,
    noKeyRetryMinutes: 10,
    noKeyRetryCount: 2,
    triggerStatuses: ['On Hold'],
  });
  const [categoryForm, setCategoryForm] = useState({ name: '', type: 'Income' as string, color: '#10B981', parentId: '' });
  const [paymentForm, setPaymentForm] = useState({ name: '', description: '' });
  const [unitForm, setUnitForm] = useState({ name: '', shortName: '', description: '', isFraction: false });

  // CarryBee Stores state
  const [carryBeeStores, setCarryBeeStores] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingCarryBeeStores, setLoadingCarryBeeStores] = useState(false);

  // Auto-save: per-tab refs
  // `firstTriggerRef` — true until the first auto-save trigger (from init), then false. Prevents saving on initial data load.
  // `justSavedRef` — set to true before a save call, consumed by init effects to skip re-initializing from server response.
  const companyFirstTriggerRef = useRef(true);
  const companyJustSavedRef = useRef(false);
  const orderFirstTriggerRef = useRef(true);
  const orderJustSavedRef = useRef(false);
  const defaultsFirstTriggerRef = useRef(true);
  const defaultsJustSavedRef = useRef(false);
  const walletFirstTriggerRef = useRef(true);
  const walletJustSavedRef = useRef(false);
  const courierFirstTriggerRef = useRef(true);
  const courierJustSavedRef = useRef(false);
  const dashboardFirstTriggerRef = useRef(true);
  const dashboardJustSavedRef = useRef(false);
  const dashboardSavingRef = useRef(false);
  const permissionsFirstTriggerRef = useRef(true);
  const permissionsJustSavedRef = useRef(false);
  const beSmartFirstTriggerRef = useRef(true);
  const beSmartJustSavedRef = useRef(false);
  const metaAdsFirstTriggerRef = useRef(true);
  const metaAdsJustSavedRef = useRef(false);
  const voiceSurveyFirstTriggerRef = useRef(true);
  const voiceSurveyJustSavedRef = useRef(false);
  const expandedCompanyPagesInitRef = useRef(false);

  const loading = companyLoading || orderLoading || invoiceLoading || defaultsLoading || courierLoading || walletLoading || permissionsLoading || ((activeTab === 'dashboard' || activeTab === 'permissions') && dashboardSettingsLoading) || loadingCategories || loadingPaymentMethods || loadingUnits || (activeTab === 'meta-ads' && (metaAdsLoading || metaAdsSettingsLoading)) || (activeTab === 'voice-survey' && voiceSurveyLoading) || (activeTab === 'be-smart' && beSmartLoading);

  // Initialize forms when data loads from React Query.
  // If we just saved, consume justSavedRef and skip — the local state is already correct.
  React.useEffect(() => {
    if (companyJustSavedRef.current) { companyJustSavedRef.current = false; return; }
    const normalized = normalizeCompanySettings(companySettingsData || db.settings.company);
    setCompanySettings(normalized);
    if (!expandedCompanyPagesInitRef.current) {
      expandedCompanyPagesInitRef.current = true;
      setExpandedCompanyPages(
        normalized.pages.reduce<Record<string, boolean>>((acc, page) => {
          acc[page.id] = false;
          return acc;
        }, {}),
      );
    } else {
      setExpandedCompanyPages((current) => {
        const next: Record<string, boolean> = {};
        for (const page of normalized.pages) {
          next[page.id] = current[page.id] ?? false;
        }
        return next;
      });
    }
  }, [companySettingsData]);

  React.useEffect(() => {
    if (orderJustSavedRef.current) { orderJustSavedRef.current = false; return; }
    if (orderSettingsData) setOrderSettings(orderSettingsData);
  }, [orderSettingsData]);

  React.useEffect(() => {
    if (orderJustSavedRef.current) { orderJustSavedRef.current = false; return; }
    if (invoiceSettingsData) setInvoiceSettings(invoiceSettingsData);
  }, [invoiceSettingsData]);

  React.useEffect(() => {
    if (defaultsJustSavedRef.current) { defaultsJustSavedRef.current = false; return; }
    if (systemDefaultsData) {
      setSystemDefaults((current) => {
        const next = {
          ...systemDefaultsData,
          themeColor: systemDefaultsData.themeColor || '#0f2f57',
        } as Settings['defaults'];
        systemDefaultsDirtyFieldsRef.current.forEach((field) => {
          (next as any)[field] = current[field];
        });
        return next;
      });
    }
  }, [systemDefaultsData]);

  React.useEffect(() => {
    if (!canUsePurchasePriceCogs || !systemDefaultsData?.calculateCogsFromPurchasePrice) {
      setCogsBackfillStatus(null);
      return;
    }
    fetchOrderCogsBackfillStatus().then(setCogsBackfillStatus).catch(() => setCogsBackfillStatus(null));
  }, [canUsePurchasePriceCogs, systemDefaultsData?.calculateCogsFromPurchasePrice]);

  const runCogsBackfill = useCallback(async () => {
    setCogsBackfillRunning(true);
    const toastId = toast.loading('Generating COGS expenses for past delivered orders...');
    try {
      let status = await backfillOrderCogsExpenses();
      let generated = status.generatedTransactions;
      let zeroCost = status.zeroCostOrders;
      while (status.missingOrders > 0) {
        status = await backfillOrderCogsExpenses();
        generated += status.generatedTransactions;
        zeroCost += status.zeroCostOrders;
      }
      setCogsBackfillStatus(status);
      queryClient.invalidateQueries({ queryKey: ['transactions'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['reports'], exact: false });
      toast.update(toastId, `Historical COGS completed: ${generated} expense transaction(s), ${zeroCost} zero-cost order(s).`, 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Historical COGS generation failed.', 'error');
    } finally {
      setCogsBackfillRunning(false);
    }
  }, [queryClient, toast]);

  const setSystemDefaultField = useCallback(<K extends SystemDefaultField,>(field: K, value: Settings['defaults'][K]) => {
    systemDefaultsDirtyFieldsRef.current.add(field);
    setSystemDefaults((current) => ({ ...current, [field]: value }));
  }, []);

  const isDeveloper = user?.role === 'Developer';

  React.useEffect(() => {
    if (courierJustSavedRef.current) { courierJustSavedRef.current = false; return; }
    if (courierSettingsData) setCourierSettings(courierSettingsData);
  }, [courierSettingsData]);

  React.useEffect(() => {
    if (walletJustSavedRef.current) { walletJustSavedRef.current = false; return; }
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
    if (permissionsJustSavedRef.current) { permissionsJustSavedRef.current = false; return; }
    if (permissionsSettingsData && !permissionsDirtyRef.current) {
      setPermissionsSettings(clonePermissionsSettings(permissionsSettingsData));
    }
  }, [permissionsSettingsData]);

  React.useEffect(() => {
    if (dashboardJustSavedRef.current) { dashboardJustSavedRef.current = false; return; }
    if (dashboardSettingsData && !dashboardDirtyRef.current) {
      setDashboardSettings(cloneDashboardSettings(dashboardSettingsData));
    }
  }, [dashboardSettingsData]);

  React.useEffect(() => {
    const threshold = Number(systemDefaultsData?.lowStockThreshold);
    if (Number.isFinite(threshold) && threshold > 0 && !lowStockThresholdDirtyRef.current) {
      setLowStockThreshold(threshold);
    }
  }, [systemDefaultsData?.lowStockThreshold]);

  React.useEffect(() => {
    if (metaAdsJustSavedRef.current) { metaAdsJustSavedRef.current = false; return; }
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
        exchangeRateMode: metaAdsSettingsData.exchangeRateMode || 'fixed',
        vatPercentage: metaAdsSettingsData.vatPercentage ?? null,
        realtimeRateCache: metaAdsSettingsData.realtimeRateCache ?? null,
        realtimeRateUpdatedAt: metaAdsSettingsData.realtimeRateUpdatedAt ?? null,
        resolvedRateToBdt: metaAdsSettingsData.resolvedRateToBdt ?? null,
      });
    }
  }, [metaAdsSettingsData]);

  React.useEffect(() => {
    if (voiceSurveyJustSavedRef.current) { voiceSurveyJustSavedRef.current = false; return; }
    if (voiceSurveySettingsData) {
      setVoiceSurveySettings({
        enabled: voiceSurveySettingsData.enabled ?? false,
        delayMinutes: voiceSurveySettingsData.delayMinutes ?? 5,
        missedCallRetryMinutes: voiceSurveySettingsData.missedCallRetryMinutes ?? 30,
        missedCallRetryCount: voiceSurveySettingsData.missedCallRetryCount ?? 3,
        noKeyRetryMinutes: voiceSurveySettingsData.noKeyRetryMinutes ?? 10,
        noKeyRetryCount: voiceSurveySettingsData.noKeyRetryCount ?? 2,
        triggerStatuses: [voiceSurveySettingsData.triggerStatuses?.[0] === 'Created'
          ? 'On Hold'
          : (voiceSurveySettingsData.triggerStatuses?.[0] || 'On Hold')],
      });
    }
  }, [voiceSurveySettingsData]);

  React.useEffect(() => {
    if (beSmartJustSavedRef.current) { beSmartJustSavedRef.current = false; return; }
    if (beSmartSettingsData) setBeSmartSettings(beSmartSettingsData);
  }, [beSmartSettingsData]);

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
      if (!canUseCarryBee) {
        setCarryBeeStores([]);
        return;
      }
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
  }, [canUseCarryBee, courierSettings.carryBee.baseUrl, courierSettings.carryBee.clientId, courierSettings.carryBee.clientSecret, courierSettings.carryBee.clientContext]);

  React.useEffect(() => {
    const result = searchParams.get('meta_ads');
    const message = searchParams.get('message') || '';
    if (!result) return;

    if (result === 'connected') {
      toast.success('Meta Ads connected. Your latest results are ready.');
      queryClient.invalidateQueries({ queryKey: ['meta-ads'], exact: false });
    } else if (result === 'error') {
      toast.error(message || 'Meta Ads connection failed.');
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('meta_ads');
    nextParams.delete('message');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, toast, queryClient]);

  // Auto-save: Company
  const saveCompany = useCallback(async () => {
    companyJustSavedRef.current = true;
    const normalizedCompany = normalizeCompanySettings(companySettings);
    const response = await batchUpdateMutation.mutateAsync({ company: normalizedCompany });
    if (response?.company) {
      db.settings.company = response.company;
      queryClient.setQueryData(['settings', 'company'], response.company);
    }
    saveDb();
  }, [companySettings, batchUpdateMutation, queryClient]);
  const { isSaving: companySaving, trigger: triggerCompanySave } = useAutoSave({ save: saveCompany });
  useEffect(() => {
    if (companyFirstTriggerRef.current) { companyFirstTriggerRef.current = false; return; }
    triggerCompanySave();
  }, [companySettings, triggerCompanySave]);

  // Auto-save: Order & Invoice
  const saveOrder = useCallback(async () => {
    orderJustSavedRef.current = true;
    const response = await batchUpdateMutation.mutateAsync({ order: orderSettings, invoice: invoiceSettings });
    if (response?.order) queryClient.setQueryData(['settings', 'order'], response.order);
    if (response?.invoice) queryClient.setQueryData(['settings', 'invoice'], response.invoice);
    saveDb();
  }, [orderSettings, invoiceSettings, batchUpdateMutation, queryClient]);
  const { isSaving: orderSaving, trigger: triggerOrderSave } = useAutoSave({ save: saveOrder });
  useEffect(() => {
    if (orderFirstTriggerRef.current) { orderFirstTriggerRef.current = false; return; }
    triggerOrderSave();
  }, [orderSettings, invoiceSettings, triggerOrderSave]);

  // Auto-save: Defaults
  const saveDefaults = useCallback(async () => {
    const dirtyFields = Array.from(systemDefaultsDirtyFieldsRef.current);
    if (dirtyFields.length === 0) return;
    defaultsJustSavedRef.current = true;
    const payload = dirtyFields.reduce<Record<string, unknown>>((acc, field) => {
      acc[field] = systemDefaults[field];
      return acc;
    }, {});
    const response = await batchUpdateMutation.mutateAsync({ defaults: payload });
    systemDefaultsDirtyFieldsRef.current.clear();
    if (response?.defaults) {
      db.settings.defaults = response.defaults;
      writeSystemDefaultsCache(response.defaults);
      queryClient.setQueryData(['settings', 'defaults'], response.defaults);
    }
    saveDb();
  }, [systemDefaults, batchUpdateMutation, queryClient]);
  const { isSaving: defaultsSaving, trigger: triggerDefaultsSave } = useAutoSave({ save: saveDefaults });
  useEffect(() => {
    if (defaultsFirstTriggerRef.current) { defaultsFirstTriggerRef.current = false; return; }
    triggerDefaultsSave();
  }, [systemDefaults, triggerDefaultsSave]);

  // Auto-save: Wallet
  const saveWallet = useCallback(async () => {
    walletJustSavedRef.current = true;
    const response = await batchUpdateMutation.mutateAsync({ wallet: walletSettings });
    if (response?.wallet) {
      db.settings.payroll = { ...db.settings.payroll, unitAmount: response.wallet.unitAmount, countedStatuses: response.wallet.countedStatuses };
    }
    saveDb();
  }, [walletSettings, batchUpdateMutation, queryClient]);
  const { isSaving: walletSaving, trigger: triggerWalletSave } = useAutoSave({ save: saveWallet });
  useEffect(() => {
    if (walletFirstTriggerRef.current) { walletFirstTriggerRef.current = false; return; }
    triggerWalletSave();
  }, [walletSettings, triggerWalletSave]);

  // Auto-save: Courier
  const saveCourier = useCallback(async () => {
    if (!hasCapability('courier_automation')) return;
    courierJustSavedRef.current = true;
    const enabledCourierSettings: Partial<CourierSettings> = {
      automaticallyDeductShippingCosts: courierSettings.automaticallyDeductShippingCosts,
      automaticallyMarkPaidAfterDelivery: courierSettings.automaticallyMarkPaidAfterDelivery,
    };
    if (canUseSteadfast) enabledCourierSettings.steadfast = courierSettings.steadfast;
    if (canUseCarryBee) enabledCourierSettings.carryBee = courierSettings.carryBee;
    if (canUsePaperfly) enabledCourierSettings.paperfly = courierSettings.paperfly;
    if (canUsePathao) enabledCourierSettings.pathao = courierSettings.pathao;
    if (Object.keys(enabledCourierSettings).length <= 2) return;
    const response = await batchUpdateMutation.mutateAsync({ courier: enabledCourierSettings });
    if (response?.courier) db.settings.courier = response.courier;
    saveDb();
  }, [courierSettings, batchUpdateMutation, queryClient, hasCapability, canUseSteadfast, canUseCarryBee, canUsePaperfly, canUsePathao]);
  const { isSaving: courierSaving, trigger: triggerCourierSave } = useAutoSave({ save: saveCourier });
  useEffect(() => {
    if (courierFirstTriggerRef.current) { courierFirstTriggerRef.current = false; return; }
    triggerCourierSave();
  }, [courierSettings, triggerCourierSave]);

  // Auto-save: Dashboard
  const saveDashboard = useCallback(async () => {
    dashboardJustSavedRef.current = true;
    dashboardSavingRef.current = true;
    try {
      const saved = await updateDashboardSettingsMutation.mutateAsync(cloneDashboardSettings(dashboardSettings));
      const persisted = cloneDashboardSettings(saved);
      dashboardDirtyRef.current = false;
      setDashboardDirty(false);
      setDashboardSettings(persisted);
      queryClient.setQueryData(['settings', 'dashboards'], persisted);
      if (lowStockThresholdDirtyRef.current) {
        const savedDefaults = await updateSystemDefaultsMutation.mutateAsync({ lowStockThreshold });
        lowStockThresholdDirtyRef.current = false;
        setLowStockThresholdDirty(false);
        const defaultsData = savedDefaults?.data ?? savedDefaults;
        if (defaultsData) queryClient.setQueryData(['settings', 'defaults'], defaultsData);
      }
    } finally {
      dashboardSavingRef.current = false;
    }
  }, [dashboardSettings, lowStockThreshold, updateDashboardSettingsMutation, updateSystemDefaultsMutation, queryClient]);
  const { isSaving: dashboardSaving, trigger: triggerDashboardSave } = useAutoSave({ save: saveDashboard });
  useEffect(() => {
    if (dashboardFirstTriggerRef.current) { dashboardFirstTriggerRef.current = false; return; }
    if (!dashboardDirty && !lowStockThresholdDirty) return;
    triggerDashboardSave();
  }, [dashboardSettings, lowStockThreshold, dashboardDirty, lowStockThresholdDirty, triggerDashboardSave]);

  // Auto-save: Permissions
  const savePermissions = useCallback(async () => {
    permissionsJustSavedRef.current = true;
    if (dashboardDirtyRef.current && !dashboardSavingRef.current) {
      const savedDashboards = await updateDashboardSettingsMutation.mutateAsync(cloneDashboardSettings(dashboardSettings));
      const persistedDashboards = cloneDashboardSettings(savedDashboards);
      dashboardDirtyRef.current = false;
      setDashboardDirty(false);
      setDashboardSettings(persistedDashboards);
    }
    const savedPermissions = await updatePermissionsSettingsMutation.mutateAsync(clonePermissionsSettings(permissionsSettings));
    const persistedPermissions = clonePermissionsSettings(savedPermissions);
    permissionsDirtyRef.current = false;
    setPermissionsDirty(false);
    setPermissionsSettings(persistedPermissions);
    db.settings.permissions = persistedPermissions as any;
    queryClient.setQueryData(['settings', 'permissions'], persistedPermissions);
  }, [permissionsSettings, dashboardSettings, updatePermissionsSettingsMutation, updateDashboardSettingsMutation, queryClient]);
  const { isSaving: permissionsSaving, trigger: triggerPermissionsSave } = useAutoSave({ save: savePermissions });
  useEffect(() => {
    if (permissionsFirstTriggerRef.current) { permissionsFirstTriggerRef.current = false; return; }
    if (!permissionsDirty && !dashboardDirty) return;
    triggerPermissionsSave();
  }, [permissionsSettings, dashboardSettings, permissionsDirty, dashboardDirty, triggerPermissionsSave]);

  // Auto-save: Be Smart
  const saveBeSmart = useCallback(async () => {
    beSmartJustSavedRef.current = true;
    await updateBeSmartSettingsMutation.mutateAsync({
      smartCustomerAdding: Boolean(capabilities.sales) && beSmartSettings.smartCustomerAdding,
      smartVendorAdding: Boolean(capabilities.purchases) && beSmartSettings.smartVendorAdding,
      smartOrderCustomerSelection: Boolean(capabilities.sales) && beSmartSettings.smartOrderCustomerSelection,
      smartBillVendorSelection: Boolean(capabilities.purchases) && beSmartSettings.smartBillVendorSelection,
    });
  }, [beSmartSettings, capabilities.sales, capabilities.purchases, updateBeSmartSettingsMutation]);
  const { isSaving: beSmartSaving, trigger: triggerBeSmartSave } = useAutoSave({ save: saveBeSmart });
  useEffect(() => {
    if (beSmartFirstTriggerRef.current) { beSmartFirstTriggerRef.current = false; return; }
    triggerBeSmartSave();
  }, [beSmartSettings, triggerBeSmartSave]);

  // Auto-save: Meta Ads
  const saveMetaAds = useCallback(async () => {
    metaAdsJustSavedRef.current = true;
    await updateMetaAdsSettingsMutation.mutateAsync(metaAdsSettings);
    queryClient.setQueryData(['meta-ads', 'settings'], metaAdsSettings);
  }, [metaAdsSettings, updateMetaAdsSettingsMutation, queryClient]);
  const { isSaving: metaAdsSaving, trigger: triggerMetaAdsSave } = useAutoSave({ save: saveMetaAds });
  useEffect(() => {
    if (metaAdsFirstTriggerRef.current) { metaAdsFirstTriggerRef.current = false; return; }
    triggerMetaAdsSave();
  }, [metaAdsSettings, triggerMetaAdsSave]);

  // Auto-save: Voice Survey
  const saveVoiceSurvey = useCallback(async () => {
    voiceSurveyJustSavedRef.current = true;
    await updateVoiceSurveySettingsMutation.mutateAsync(voiceSurveySettings);
    queryClient.setQueryData(['settings', 'voice-survey'], voiceSurveySettings);
  }, [voiceSurveySettings, updateVoiceSurveySettingsMutation, queryClient]);
  const { isSaving: voiceSurveySaving, trigger: triggerVoiceSurveySave } = useAutoSave({ save: saveVoiceSurvey });
  useEffect(() => {
    if (voiceSurveyFirstTriggerRef.current) { voiceSurveyFirstTriggerRef.current = false; return; }
    triggerVoiceSurveySave();
  }, [voiceSurveySettings, triggerVoiceSurveySave]);

  const isTabSaving = activeTab === 'company' ? companySaving
    : activeTab === 'order' ? orderSaving
    : activeTab === 'defaults' ? defaultsSaving
    : activeTab === 'wallet' ? walletSaving
    : activeTab === 'courier' ? courierSaving
    : activeTab === 'dashboard' ? dashboardSaving
    : activeTab === 'permissions' ? permissionsSaving
    : activeTab === 'be-smart' ? beSmartSaving
    : activeTab === 'meta-ads' ? metaAdsSaving
    : activeTab === 'voice-survey' ? voiceSurveySaving
    : false;

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

  const handleCompanyPageLogoUpload = async (pageId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const compressed = await compressImage(file, { maxWidth: 600, maxHeight: 600, quality: 0.85 });
      handleCompanyPageChange(pageId, 'logo', compressed);
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        handleCompanyPageChange(pageId, 'logo', reader.result as string);
      };
      reader.readAsDataURL(file);
    }
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

  const handlePermissionsChange = useCallback((next: PermissionsSettings) => {
    permissionsDirtyRef.current = true;
    setPermissionsDirty(true);
    setPermissionsSettings(next);
  }, []);

  const handleDashboardChange = useCallback((next: DashboardSettings) => {
    dashboardDirtyRef.current = true;
    setDashboardDirty(true);
    setDashboardSettings(next);
    setPermissionsSettings((current) => {
      const fallback = next.dashboards.find((dashboard) => dashboard.id === EMPLOYEE_DEFAULT_DASHBOARD_ID)
        || next.dashboards[0];
      if (!fallback) return current;
      return {
        roles: current.roles.map((role) => {
          const assigned = next.dashboards.find((dashboard) => dashboard.id === role.dashboardId) || fallback;
          return {
            ...role,
            dashboardId: assigned.id,
            permissions: {
              ...role.permissions,
              'dashboard.viewAdmin': dashboardHasScope(assigned, 'admin'),
              'dashboard.viewEmployee': dashboardHasScope(assigned, 'employee'),
            },
          };
        }),
      };
    });
  }, []);

  const handleLowStockThresholdChange = useCallback((next: number) => {
    lowStockThresholdDirtyRef.current = true;
    setLowStockThresholdDirty(true);
    setLowStockThreshold(next);
  }, []);

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
      toast.update(toastId, err instanceof Error ? err.message : 'Could not add the category. Please try again.', 'error');
      
      // Reopen modal so user can try again
      setShowModal('category');
      setCategoryForm(formData);
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
    const toastId = toast.loading('Refreshing Meta Ads...');
    try {
      const result = await syncMetaAdsMutation.mutateAsync();
      if (result?.ok === false && result?.cooldownRemainingSeconds > 0) {
        applyMetaCooldown(result.cooldownRemainingSeconds);
        toast.update(toastId, 'Please wait ' + result.cooldownRemainingSeconds + ' seconds before refreshing again.', 'error');
      } else if (result?.started) {
        // Background sync started — don't await completion
        applyMetaCooldown(120);
        toast.update(toastId, 'Your latest Meta Ads results will appear here shortly.', 'success');
      } else {
        // Synchronous fallback completed
        applyMetaCooldown(120);
        toast.update(toastId, 'Meta Ads results are up to date.', 'success');
        await queryClient.invalidateQueries({ queryKey: ['meta-ads'], exact: false });
        await refetchMetaAdsSyncStatus();
        await refetchMetaAdsConnectionStatus();
      }
    } catch (err) {
      toast.update(toastId, err instanceof Error ? err.message : 'Could not refresh Meta Ads results. Please try again.', 'error');
    }
  }, [metaAdsCooldown, syncMetaAdsMutation, toast, queryClient, refetchMetaAdsSyncStatus, applyMetaCooldown]);

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Are you sure you want to delete this category?')) return;
    try {
      await deleteCategoryMutation.mutateAsync(id);
      toast.success('Category deleted successfully!');
    } catch (err) {
      console.error('Failed to delete category:', err);
      toast.error(err instanceof Error ? err.message : 'Could not delete the category. Please try again.');
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
      toast.update(toastId, err instanceof Error ? err.message : 'Could not add the payment method. Please try again.', 'error');
      
      // Reopen modal so user can try again
      setShowModal('payment');
      setPaymentForm(formData);
    }
  };

  const handleDeletePayment = async (id: string) => {
    if (id === 'cash') {
      toast.warning('Cash is a system payment method and cannot be deleted.');
      return;
    }
    if (!confirm('Are you sure you want to delete this payment method?')) return;
    try {
      await deletePaymentMutation.mutateAsync(id);
      toast.success('Payment method deleted successfully!');
    } catch (err) {
      console.error('Failed to delete payment method:', err);
      toast.error(err instanceof Error ? err.message : 'Could not delete the payment method. Please try again.');
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
      is_fraction: unitForm.isFraction,
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
    setUnitForm({ name: '', shortName: '', description: '', isFraction: false });
    setShowModal(null);

    try {
      // Save to database
      await createUnitMutation.mutateAsync({
        name: formData.name,
        shortName: formData.shortName,
        description: formData.description || undefined,
        isFraction: formData.isFraction,
      });
      
      // Update toast to success
      toast.update(toastId, 'Unit added successfully!', 'success');
    } catch (err) {
      console.error('Failed to add unit:', err);
      // Rollback cache on error
      queryClient.setQueryData(['units'], previousUnits);
      
      // Show error toast
      toast.update(toastId, err instanceof Error ? err.message : 'Could not add the unit. Please try again.', 'error');
      
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
      toast.error(err instanceof Error ? err.message : 'Could not delete the unit. Please try again.');
    }
  };

  const tabs = [
    canEditCompanySettings ? { id: 'company', label: 'Company', icon: ICONS.Dashboard } : null,
    canEditOrderInvoiceSettings ? { id: 'order', label: 'Order & Invoice', icon: ICONS.Sales } : null,
    canEditDefaults ? { id: 'defaults', label: 'Defaults', icon: ICONS.Settings } : null,
    capabilities.be_smart && hasAdminAccess(user?.role) ? { id: 'be-smart', label: 'Be Smart', icon: ICONS.Bell } : null,
    canUsePayroll && canEditWalletSettings ? { id: 'wallet', label: 'Wallet', icon: ICONS.Payroll } : null,
    hasCapability('marketing') && canSyncAds ? { id: 'meta-ads', label: 'Meta Ads', icon: ICONS.Bell } : null,
    hasCapability('whatsapp') && hasAdminAccess(user?.role) ? { id: 'whatsapp', label: 'WhatsApp', icon: ICONS.WhatsApp } : null,
    hasCapability('messenger') && hasAdminAccess(user?.role) ? { id: 'messenger', label: 'Messenger', icon: ICONS.Messenger } : null,
    hasCapability('woocommerce') && hasAdminAccess(user?.role) ? { id: 'woocommerce', label: 'WooCommerce', icon: ICONS.Sales } : null,
    hasCapability('shopify') && hasAdminAccess(user?.role) ? { id: 'shopify', label: 'Shopify', icon: ICONS.Sales } : null,
    hasAdminAccess(user?.role) ? { id: 'dashboard', label: 'Dashboard', icon: ICONS.Dashboard } : null,
    hasCapability('custom_roles') && canManagePermissions ? { id: 'permissions', label: 'Permissions', icon: ICONS.Users } : null,
    canEditCategories ? { id: 'categories', label: 'Categories', icon: ICONS.More } : null,
    canEditPaymentMethods ? { id: 'payments', label: 'Payment Methods', icon: ICONS.Banking } : null,
    canEditPaymentMethods ? { id: 'units', label: 'Units', icon: ICONS.Products } : null,
    hasCapability('courier_automation') && canEditCourierSettings ? { id: 'courier', label: 'Courier', icon: ICONS.Courier } : null,
    hasCapability('auto_calling') && hasAdminAccess(user?.role) ? { id: 'voice-survey', label: 'Voice Survey', icon: ICONS.Bell } : null,
    hasAdminAccess(user?.role) ? { id: 'data-management', label: 'Import & Export', icon: ICONS.Download } : null,
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
    <div className="max-w-6xl mx-auto space-y-4">
      <LoadingOverlay isLoading={loading} message="Loading settings..." />
      <div className="flex items-center justify-between">
        <div />
        {isTabSaving ? (
          <span className="flex items-center gap-2 text-sm font-medium text-gray-500">
            <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            Saving…
          </span>
        ) : (
          <span className="flex items-center gap-2 text-sm font-medium text-emerald-600">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            Saved
          </span>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
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

        <div className="flex-1 min-w-0 bg-white p-6 rounded-xl border border-gray-100 shadow-sm min-h-[500px]">
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
                                  <img src={page.logo} className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/uploads/Avatar.png'; }} />
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
                {canUseAccounts && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Account</label>
                    <select
                      value={systemDefaults.defaultAccountId}
                      onChange={e => setSystemDefaultField('defaultAccountId', e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                    >
                      <option value="">Select an account...</option>
                      {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Payment Method</label>
                  <select 
                    value={systemDefaults.defaultPaymentMethod}
                    onChange={e => setSystemDefaultField('defaultPaymentMethod', e.target.value)}
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
                    onChange={e => setSystemDefaultField('incomeCategoryId', e.target.value)}
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
                      onChange={e => setSystemDefaultField('themeColor', e.target.value)}
                      className="w-28 h-12 p-0 border border-gray-100 rounded-2xl cursor-pointer"
                    />
                    <span className="text-sm font-medium text-gray-600">{systemDefaults.themeColor}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Product Selection Mode</label>
                  <select
                    value={systemDefaults.productSelectionMode}
                    onChange={e => setSystemDefaultField('productSelectionMode', e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                  >
                    <option value="simple">Simple — click to add instantly</option>
                    <option value="multi">Multi-select — select then add</option>
                  </select>
                </div>
                {canUsePurchasePriceCogs && (
                  <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={systemDefaults.calculateCogsFromPurchasePrice}
                        onChange={e => setSystemDefaultField('calculateCogsFromPurchasePrice', e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                      />
                      <span>
                        <span className="block text-sm font-bold text-gray-800">Calculate COGS from product purchase prices</span>
                        <span className="mt-1 block text-xs leading-5 text-gray-600">
                          When an order is delivered, create one Purchases expense using each delivered product's current purchase price × quantity. This option is available because Bills &amp; Purchases is not active.
                        </span>
                      </span>
                    </label>
                    {systemDefaultsData?.calculateCogsFromPurchasePrice && cogsBackfillStatus && cogsBackfillStatus.missingOrders > 0 && (
                      <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-bold text-gray-800">Repair historical delivered orders</p>
                          <p className="mt-1 text-xs text-gray-600">{cogsBackfillStatus.missingOrders.toLocaleString()} delivered order(s) do not have a purchase-price COGS record yet. Current product purchase prices will be used.</p>
                        </div>
                        <Button onClick={runCogsBackfill} disabled={cogsBackfillRunning}>
                          {cogsBackfillRunning ? 'Generating...' : 'Generate Past COGS'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Records Per Page</label>
                  <NumericInput 
                    value={systemDefaults.recordsPerPage} 
                    onChange={value => setSystemDefaultField('recordsPerPage', Math.max(1, value))}
                    className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3"
                    allowDecimals={false}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Expense Category</label>
                  <select 
                    value={systemDefaults.expenseCategoryId}
                    onChange={e => setSystemDefaultField('expenseCategoryId', e.target.value)}
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
                      setSystemDefaultField('maxTransactionAmount', Math.max(0, value))
                    }
                    className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3"
                    allowDecimals={true}
                    decimalPlaces={2}
                  />
                  <p className="text-xs font-medium text-gray-400">
                    Transactions above this amount will stay pending until an admin accepts or declines them.
                  </p>
                </div>
                <div className="space-y-2 md:col-span-2 pt-2">
                  <label className="flex items-start gap-3 cursor-pointer p-4 rounded-xl border border-gray-100 bg-gray-50/50 hover:bg-gray-50 transition-colors">
                    <input
                      type="checkbox"
                      checked={systemDefaults.automaticFraudCheckOnOrderCreation ?? false}
                      onChange={e => setSystemDefaultField('automaticFraudCheckOnOrderCreation', e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[var(--primary-color,#0f2f57)] focus:ring-[var(--primary-color,#0f2f57)]"
                    />
                    <div>
                      <span className="block text-sm font-bold text-gray-800">Automatic fraud check on order creation</span>
                      <span className="mt-1 block text-xs leading-5 text-gray-600">
                        Automatically run a background courier history check for the customer's phone number when a new order is created.
                      </span>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'be-smart' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="border-b border-gray-100 pb-4">
                <h3 className="text-xl font-black text-gray-900">Be Smart</h3>
                <p className="mt-1 text-sm font-medium text-gray-500">Replace separate contact fields with one friendly paste box. MamePilot extracts the values using the model assigned to Information extraction in Developer Settings &gt; LLMs.</p>
              </div>

              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
                The final phone number is normalized again on the server and is saved only when it is exactly 11 digits and starts with 0.
              </div>

              <div className="grid gap-4">
                {capabilities.sales && (
                  <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 transition hover:border-[#3c5a82]/30">
                    <input
                      type="checkbox"
                      checked={beSmartSettings.smartCustomerAdding}
                      onChange={(event) => setBeSmartSettings((current) => ({ ...current, smartCustomerAdding: event.target.checked }))}
                      className="mt-1 h-5 w-5 rounded border-gray-300 text-[#3c5a82] focus:ring-[#3c5a82]"
                    />
                    <div>
                      <p className="font-black text-gray-900">Smart customer adding</p>
                      <p className="mt-1 text-sm font-medium text-gray-500">Use a single raw-details box on new and edit customer pages.</p>
                    </div>
                  </label>
                )}
                {capabilities.purchases && (
                  <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 transition hover:border-[#3c5a82]/30">
                    <input
                      type="checkbox"
                      checked={beSmartSettings.smartVendorAdding}
                      onChange={(event) => setBeSmartSettings((current) => ({ ...current, smartVendorAdding: event.target.checked }))}
                      className="mt-1 h-5 w-5 rounded border-gray-300 text-[#3c5a82] focus:ring-[#3c5a82]"
                    />
                    <div>
                      <p className="font-black text-gray-900">Smart vendor adding</p>
                      <p className="mt-1 text-sm font-medium text-gray-500">Use a single raw-details box on new and edit vendor pages.</p>
                    </div>
                  </label>
                )}
                {capabilities.sales && (
                  <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 transition hover:border-[#3c5a82]/30">
                    <input
                      type="checkbox"
                      checked={beSmartSettings.smartOrderCustomerSelection}
                      onChange={(event) => setBeSmartSettings((current) => ({ ...current, smartOrderCustomerSelection: event.target.checked }))}
                      className="mt-1 h-5 w-5 rounded border-gray-300 text-[#3c5a82] focus:ring-[#3c5a82]"
                    />
                    <div>
                      <p className="font-black text-gray-900">Smart customer selection</p>
                      <p className="mt-1 text-sm font-medium text-gray-500">Replace the customer dropdown on the order form with a smart paste box. Paste customer details and the system will find or create the customer automatically.</p>
                    </div>
                  </label>
                )}
                {capabilities.purchases && (
                  <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 transition hover:border-[#3c5a82]/30">
                    <input
                      type="checkbox"
                      checked={beSmartSettings.smartBillVendorSelection}
                      onChange={(event) => setBeSmartSettings((current) => ({ ...current, smartBillVendorSelection: event.target.checked }))}
                      className="mt-1 h-5 w-5 rounded border-gray-300 text-[#3c5a82] focus:ring-[#3c5a82]"
                    />
                    <div>
                      <p className="font-black text-gray-900">Smart vendor selection</p>
                      <p className="mt-1 text-sm font-medium text-gray-500">Replace the vendor dropdown on the bill form with a smart paste box. Paste vendor details and the system will find or create the vendor automatically.</p>
                    </div>
                  </label>
                )}
                {!capabilities.sales && !capabilities.purchases && (
                  <p className="rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm font-semibold text-gray-500">Enable Sales &amp; Customer Management or Purchases &amp; Vendor Management to configure a smart contact form.</p>
                )}
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
                    {ORDER_STATUS_VALUES.filter((status) => status !== OrderStatus.CREATED).map((status) => {
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
                  <h4 className="text-base font-black text-gray-900">Ad account currency</h4>
                  <p className="mt-1 text-sm text-gray-500">
                    Currency used by your Meta ad account. Marketing amounts are always shown in ৳ (BDT); hovering shows the equivalent in this ads currency.
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>Ad account currency</span>
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
                    <div className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>Exchange rate mode</span>
                      <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-1">
                        <button
                          type="button"
                          onClick={() => setMetaAdsSettings((current) => ({ ...current, exchangeRateMode: 'fixed' }))}
                          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                            metaAdsSettings.exchangeRateMode === 'fixed'
                              ? 'bg-white text-gray-900 shadow-sm'
                              : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          Fixed rate
                        </button>
                        <button
                          type="button"
                          onClick={() => setMetaAdsSettings((current) => ({ ...current, exchangeRateMode: 'vat_based' }))}
                          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                            metaAdsSettings.exchangeRateMode === 'vat_based'
                              ? 'bg-white text-gray-900 shadow-sm'
                              : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          VAT-based rate
                        </button>
                      </div>
                    </div>
                  </div>

                  {metaAdsSettings.displayCurrencyCode === 'BDT' ? (
                    <p className="mt-3 text-xs text-gray-400">No exchange rate needed — your ad account currency is already ৳.</p>
                  ) : metaAdsSettings.exchangeRateMode === 'fixed' ? (
                    <div className="mt-4">
                      <label className="space-y-2 text-sm font-semibold text-gray-700">
                        <span>Exchange rate — 1 {metaAdsSettings.displayCurrencyCode} = ? ৳</span>
                        <NumericInput
                          value={metaAdsSettings.displayCurrencyRateToBdt ?? ''}
                          onChange={(val) => setMetaAdsSettings((current) => ({ ...current, displayCurrencyRateToBdt: val || null }))}
                          placeholder="e.g. 120"
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                        />
                        <span className="text-xs text-gray-400">
                          Converts Meta spend into ৳ for KPIs and charts. Hover any ৳ amount to see ads currency.
                        </span>
                      </label>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      <label className="space-y-2 text-sm font-semibold text-gray-700">
                        <span>VAT / Tax percentage</span>
                        <div className="relative">
                          <NumericInput
                            value={metaAdsSettings.vatPercentage ?? ''}
                            onChange={(val) => setMetaAdsSettings((current) => ({ ...current, vatPercentage: val || null }))}
                            placeholder="e.g. 7.5"
                            decimalPlaces={2}
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 pr-10 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">%</span>
                        </div>
                        <span className="text-xs text-gray-400">
                          Real-time market rate + your VAT = final exchange rate. Rate auto-refreshes every 6 hours.
                        </span>
                      </label>
                      {metaAdsSettings.realtimeRateCache != null && metaAdsSettings.realtimeRateCache > 0 && (
                        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs">
                          <p className="font-bold text-blue-800">
                            Current rate: 1 {metaAdsSettings.displayCurrencyCode} = {((metaAdsSettings.realtimeRateCache ?? 0) * (1 + (metaAdsSettings.vatPercentage ?? 0) / 100)).toFixed(2)} ৳
                          </p>
                          <p className="mt-1 text-blue-600">
                            Market: {(metaAdsSettings.realtimeRateCache ?? 0).toFixed(2)}
                            {(metaAdsSettings.vatPercentage ?? 0) > 0 && (
                              <> + {metaAdsSettings.vatPercentage}% VAT = {((metaAdsSettings.realtimeRateCache ?? 0) * (1 + (metaAdsSettings.vatPercentage ?? 0) / 100)).toFixed(2)}</>
                            )}
                          </p>
                          {metaAdsSettings.realtimeRateUpdatedAt && (
                            <p className="mt-1 text-blue-500">
                              Last updated: {formatDateTime(metaAdsSettings.realtimeRateUpdatedAt)}
                            </p>
                          )}
                        </div>
                      )}
                      {metaAdsSettings.realtimeRateCache == null && (
                        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
                          Real-time rate will be fetched after saving. If the currency API is unavailable, a fallback rate can be set below.
                        </div>
                      )}
                      <label className="space-y-2 text-sm font-semibold text-gray-700">
                        <span>Fallback rate — 1 {metaAdsSettings.displayCurrencyCode} = ? ৳</span>
                        <NumericInput
                          value={metaAdsSettings.displayCurrencyRateToBdt ?? ''}
                          onChange={(val) => setMetaAdsSettings((current) => ({ ...current, displayCurrencyRateToBdt: val || null }))}
                          placeholder="e.g. 120"
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                        />
                        <span className="text-xs text-gray-400">
                          Used when the real-time rate cannot be fetched.
                        </span>
                      </label>
                    </div>
                  )}
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
                              Last synced: {connection.lastSyncedAt ? formatDateTime(connection.lastSyncedAt) : 'Not synced yet'}
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

          {activeTab === 'whatsapp' && <WhatsAppSettingsPanel />}
          {activeTab === 'messenger' && <MessengerSettingsPanel />}
          {activeTab === 'woocommerce' && <WooCommerceSettingsPanel companyPages={companySettings.pages} />}
          {activeTab === 'shopify' && <ShopifySettingsPanel companyPages={companySettings.pages} />}
          {activeTab === 'data-management' && <DataManagementSettingsPanel />}

          {activeTab === 'voice-survey' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <section className="space-y-6">
                <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">Voice Survey (Auto Calling)</h3>
                    <p className="mt-2 max-w-3xl text-sm text-gray-500">
                      Automatically call customers when orders are created. Customers press DTMF keys to confirm or cancel their orders.
                    </p>
                  </div>
                </div>

                {/* Master Toggle */}
                <div className="rounded-xl border border-gray-100 bg-white p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-base font-black text-gray-900">Enable Auto-Calling</h4>
                      <p className="mt-1 text-sm text-gray-500">When enabled, new orders will automatically trigger a voice survey call to the customer.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVoiceSurveySettings((s) => ({ ...s, enabled: !s.enabled }))}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${voiceSurveySettings.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${voiceSurveySettings.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>

                {voiceSurveySettingsData?.workerHealth && voiceSurveySettingsData.workerHealth.status !== 'disabled' && (
                  <div className={`rounded-xl border p-5 ${
                    voiceSurveySettingsData.workerHealth.status === 'healthy'
                      ? 'border-emerald-200 bg-emerald-50'
                      : voiceSurveySettingsData.workerHealth.status === 'stopped'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-red-200 bg-red-50'
                  }`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-black text-gray-900">Queue delivery</h4>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${
                        voiceSurveySettingsData.workerHealth.status === 'healthy'
                          ? 'bg-emerald-100 text-emerald-700'
                          : voiceSurveySettingsData.workerHealth.status === 'stopped'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                      }`}>
                        {voiceSurveySettingsData.workerHealth.status === 'healthy' ? 'Running' : 'Needs attention'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-gray-700">{voiceSurveySettingsData.workerHealth.message}</p>
                    <p className="mt-2 text-xs font-medium text-gray-500">
                      Last check: {voiceSurveySettingsData.workerHealth.lastRunAt ? formatDateTime(voiceSurveySettingsData.workerHealth.lastRunAt) : 'Never'}
                      {' · '}Pending: {voiceSurveySettingsData.workerHealth.pendingCount}
                      {' · '}Overdue: {voiceSurveySettingsData.workerHealth.overdueCount}
                    </p>
                    {voiceSurveySettingsData.workerHealth.status === 'stopped' && (
                      <p className="mt-2 text-xs text-gray-500">Attention required: automatic calling is not set up properly yet. Ask a developer to complete the setup.</p>
                    )}
                  </div>
                )}

                {/* Call Timing */}
                <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-5">
                  <h4 className="text-base font-black text-gray-900">Call Timing</h4>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <span className="text-sm font-semibold text-gray-700">Trigger auto-call for this order status</span>
                      <select
                        value={voiceSurveySettings.triggerStatuses[0] || 'On Hold'}
                        onChange={(event) => setVoiceSurveySettings((settings) => ({
                          ...settings,
                          triggerStatuses: [event.target.value],
                        }))}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-[#0f2f57]"
                      >
                        {['On Hold', 'Processing'].map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                      <span className="text-xs text-gray-400">Orders with this status will automatically trigger a voice survey call after the delay below.</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>Call delay after order creation (minutes)</span>
                      <NumericInput
                        value={voiceSurveySettings.delayMinutes}
                        onChange={(val) => setVoiceSurveySettings((s) => ({ ...s, delayMinutes: val || 5 }))}
                        placeholder="5"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                      />
                      <span className="text-xs text-gray-400">Wait this many minutes after an order is created before calling.</span>
                    </label>
                  </div>
                </div>

                {/* Retry Settings */}
                <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-5">
                  <h4 className="text-base font-black text-gray-900">Retry Settings</h4>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>Missed call retry interval (minutes)</span>
                      <NumericInput
                        value={voiceSurveySettings.missedCallRetryMinutes}
                        onChange={(val) => setVoiceSurveySettings((s) => ({ ...s, missedCallRetryMinutes: val || 30 }))}
                        placeholder="30"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                      />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>Missed call max retries</span>
                      <NumericInput
                        value={voiceSurveySettings.missedCallRetryCount}
                        onChange={(val) => setVoiceSurveySettings((s) => ({ ...s, missedCallRetryCount: val || 3 }))}
                        placeholder="3"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                      />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>No-key retry interval (minutes)</span>
                      <NumericInput
                        value={voiceSurveySettings.noKeyRetryMinutes}
                        onChange={(val) => setVoiceSurveySettings((s) => ({ ...s, noKeyRetryMinutes: val || 10 }))}
                        placeholder="10"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                      />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-gray-700">
                      <span>No-key max retries</span>
                      <NumericInput
                        value={voiceSurveySettings.noKeyRetryCount}
                        onChange={(val) => setVoiceSurveySettings((s) => ({ ...s, noKeyRetryCount: val || 2 }))}
                        placeholder="2"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none ring-0 focus:border-[#0f2f57]"
                      />
                    </label>
                  </div>
                </div>

              </section>
            </div>
          )}

          {activeTab === 'permissions' && (
            <PermissionsSettingsPanel
              value={permissionsSettings}
              onChange={handlePermissionsChange}
              dashboards={dashboardSettings.dashboards}
              hasUnsavedChanges={permissionsDirty}
            />
          )}

          {activeTab === 'dashboard' && (
            <DashboardSettingsPanel
              value={dashboardSettings}
              onChange={handleDashboardChange}
              hasUnsavedChanges={dashboardDirty || lowStockThresholdDirty}
              lowStockThreshold={lowStockThreshold}
              onLowStockThresholdChange={handleLowStockThresholdChange}
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
                        <p className="font-bold text-gray-800 flex items-center gap-2">
                          {pm.name}
                          {pm.id === 'cash' && (
                            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 bg-gray-100 border border-gray-200 rounded-md px-1.5 py-0.5" title="System payment method">
                              {ICONS.Lock} System
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">{pm.id === 'cash' ? 'Required system payment method — always available in the register.' : (pm.description || 'No description')}</p>
                      </div>
                      {pm.id === 'cash' ? (
                        <span title="Cash cannot be deleted" className="text-gray-300 px-2">
                          {ICONS.Lock}
                        </span>
                      ) : (
                        <button
                          onClick={() => handleDeletePayment(pm.id)}
                          className="text-red-500 hover:text-red-700 px-2"
                        >
                          {ICONS.Delete}
                        </button>
                      )}
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

          {activeTab === 'units' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b pb-4">
                <h3 className="text-xl font-bold text-gray-800">Product Units</h3>
                <Button
                  onClick={() => setShowModal('unit')}
                  variant="primary"
                  size="md"
                >
                  {ICONS.Plus} Add
                </Button>
              </div>
              {loadingUnits ? (
                <div className="text-center py-8 text-gray-500">Loading units...</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {units.map(unit => (
                    <div key={unit.id} className="p-4 border rounded-lg bg-gray-50/50 hover:shadow-sm transition-all flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-bold text-gray-800">{unit.name}</p>
                        <p className="text-xs text-gray-400 mt-1">{unit.isFraction ? 'Fraction (decimal)' : 'Integer (whole number)'}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteUnit(unit.id)}
                        className="text-red-500 hover:text-red-700 px-2"
                      >
                        {ICONS.Delete}
                      </button>
                    </div>
                  ))}
                  {units.length === 0 && (
                    <div className="col-span-2 text-center py-8 text-gray-500">
                      No units yet. Click "Add" to create one.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'courier' && (
            <div className="space-y-10 animate-in fade-in duration-300">
              <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={courierSettings.automaticallyDeductShippingCosts}
                    onChange={e => setCourierSettings({ ...courierSettings, automaticallyDeductShippingCosts: e.target.checked })}
                    className="mt-1 h-4 w-4 accent-[#0f2f57]"
                  />
                  <span>
                    <span className="block text-sm font-bold text-gray-800">Automatically record courier shipping costs</span>
                    <span className="block mt-1 text-xs leading-5 text-gray-600">When a courier webhook confirms delivery, MamePilot records that courier&apos;s delivery/COD fee as a Shipping Costs expense linked to the order. The manual additional-expense button is hidden for delivered orders.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer border-t border-blue-100 pt-3">
                  <input
                    type="checkbox"
                    checked={courierSettings.automaticallyMarkPaidAfterDelivery}
                    onChange={e => setCourierSettings({ ...courierSettings, automaticallyMarkPaidAfterDelivery: e.target.checked })}
                    className="mt-1 h-4 w-4 accent-[#0f2f57]"
                  />
                  <span>
                    <span className="block text-sm font-bold text-gray-800">Automatically mark paid after courier delivery</span>
                    <span className="block mt-1 text-xs leading-5 text-gray-600">When any configured courier confirms delivery, MamePilot records the remaining order value as an Income payment and marks the order fully paid. Leave this off to keep payments manual.</span>
                  </span>
                </label>
                <p className="text-[11px] leading-5 text-blue-800">Configure default account, category, and payment method per courier below. If left blank, the defaults from General Settings are used as fallback.</p>
              </section>
              {!canUseSteadfast && !canUseCarryBee && !canUsePaperfly && !canUsePathao && (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm font-medium text-gray-500">
                  No courier providers are enabled for this subscription.
                </div>
              )}
              {canUseSteadfast && (
              <section className="space-y-6">
                <h3 className="text-xl font-bold text-gray-800 border-b pb-4 flex items-center gap-2">
                  <img src="/uploads/steadfast.png" alt="Steadfast" className="w-6 h-6 rounded-full" />
                  <span className="">Steadfast</span> Secrets
                </h3>
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  Webhook URL: <code className="break-all font-semibold">{courierWebhookEndpoint('steadfast')}</code>. Steadfast webhooks are verified with the API key (Bearer or API-key header). A lightweight server check confirms open consignments if a webhook is missed.
                </div>
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
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Custom Invoice</label>
                    <input
                      type="text"
                      value={courierSettings.steadfast.invoice}
                      onChange={e => setCourierSettings({ ...courierSettings, steadfast: { ...courierSettings.steadfast, invoice: e.target.value } })}
                      maxLength={100}
                      pattern="[A-Za-z0-9_\-]*"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      placeholder="MAMEPILOT"
                    />
                    <p className="text-[11px] leading-5 text-gray-500">Must be unique. Letters, numbers, hyphens, and underscores only. Leave blank to send the order number exactly as before.</p>
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
                <div className="space-y-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-bold text-gray-700">Steadfast Defaults</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Account</label>
                      <select
                        value={courierSettings.steadfast.defaultAccountId}
                        onChange={e => setCourierSettings({...courierSettings, steadfast: {...courierSettings.steadfast, defaultAccountId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Use system default</option>
                        {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Payment Method</label>
                      <select
                        value={courierSettings.steadfast.defaultPaymentMethod}
                        onChange={e => setCourierSettings({...courierSettings, steadfast: {...courierSettings.steadfast, defaultPaymentMethod: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Use system default</option>
                        {paymentMethods.map(pm => <option key={pm.id} value={pm.name}>{pm.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Expense Category (Shipping Costs)</label>
                      <select
                        value={courierSettings.steadfast.defaultExpenseCategoryId}
                        onChange={e => setCourierSettings({...courierSettings, steadfast: {...courierSettings.steadfast, defaultExpenseCategoryId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Shipping Costs (default)</option>
                        {categories.filter(c => c.type === 'Expense').map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Income Category (Delivery Payment)</label>
                      <select
                        value={courierSettings.steadfast.defaultIncomeCategoryId}
                        onChange={e => setCourierSettings({...courierSettings, steadfast: {...courierSettings.steadfast, defaultIncomeCategoryId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Sales Income (default)</option>
                        {categories.filter(c => c.type === 'Income').map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </section>
              )}

              {canUseCarryBee && (
              <section className="space-y-6">
                <h3 className="text-xl font-bold text-gray-800 border-b pb-4 flex items-center gap-2">
                  <img src="/uploads/carrybee.png" alt="CarryBee" className="w-6 h-6 rounded-full" />
                  <span className="">CarryBee</span> Secrets
                </h3>
                <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  <p>Webhook URL: <code className="break-all font-semibold">{courierWebhookEndpoint('carrybee')}</code>. Configure this URL in the CarryBee dashboard. The integration handshake is answered with HTTP 202 and the configured integration header; every real event is verified with the signature header.</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="font-bold uppercase tracking-widest">Webhook signature header name</label>
                      <input type="text" value={courierSettings.carryBee.webhookHeader} onChange={e => setCourierSettings({ ...courierSettings, carryBee: { ...courierSettings.carryBee, webhookHeader: e.target.value } })} className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3" placeholder="X-Carrybee-Webhook-Signature" />
                    </div>
                    <div className="space-y-2">
                      <label className="font-bold uppercase tracking-widest">Webhook signature header value</label>
                      <input type="password" value={courierSettings.carryBee.webhookSignature} onChange={e => setCourierSettings({ ...courierSettings, carryBee: { ...courierSettings.carryBee, webhookSignature: e.target.value } })} className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3" placeholder="Webhook secret from CarryBee dashboard" />
                    </div>
                    <div className="space-y-2">
                      <label className="font-bold uppercase tracking-widest">Webhook integration header name</label>
                      <input type="text" value={courierSettings.carryBee.webhookIntegrationHeader} onChange={e => setCourierSettings({ ...courierSettings, carryBee: { ...courierSettings.carryBee, webhookIntegrationHeader: e.target.value } })} className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3" placeholder="X-CB-Webhook-Integration-Header" />
                    </div>
                    <div className="space-y-2">
                      <label className="font-bold uppercase tracking-widest">Webhook integration header value</label>
                      <input type="password" value={courierSettings.carryBee.webhookIntegrationValue} onChange={e => setCourierSettings({ ...courierSettings, carryBee: { ...courierSettings.carryBee, webhookIntegrationValue: e.target.value } })} className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3" placeholder="40489fe0-9386-4fc9-8e92-2b2fcb9d451c" />
                      <p className="text-[10px] text-amber-600">This value is returned in the integration header during webhook setup verification.</p>
                    </div>
                  </div>
                </div>
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
                <div className="space-y-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-bold text-gray-700">CarryBee Defaults</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Account</label>
                      <select
                        value={courierSettings.carryBee.defaultAccountId}
                        onChange={e => setCourierSettings({...courierSettings, carryBee: {...courierSettings.carryBee, defaultAccountId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Use system default</option>
                        {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Payment Method</label>
                      <select
                        value={courierSettings.carryBee.defaultPaymentMethod}
                        onChange={e => setCourierSettings({...courierSettings, carryBee: {...courierSettings.carryBee, defaultPaymentMethod: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Use system default</option>
                        {paymentMethods.map(pm => <option key={pm.id} value={pm.name}>{pm.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Expense Category (Shipping Costs)</label>
                      <select
                        value={courierSettings.carryBee.defaultExpenseCategoryId}
                        onChange={e => setCourierSettings({...courierSettings, carryBee: {...courierSettings.carryBee, defaultExpenseCategoryId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Shipping Costs (default)</option>
                        {categories.filter(c => c.type === 'Expense').map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Income Category (Delivery Payment)</label>
                      <select
                        value={courierSettings.carryBee.defaultIncomeCategoryId}
                        onChange={e => setCourierSettings({...courierSettings, carryBee: {...courierSettings.carryBee, defaultIncomeCategoryId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Sales Income (default)</option>
                        {categories.filter(c => c.type === 'Income').map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </section>
              )}

              {canUsePaperfly && (
              <section className="space-y-6">
                <h3 className="text-xl font-bold text-gray-800 border-b pb-4 flex items-center gap-2">
                  <img src="/uploads/paperfly.png" alt="Paperfly" className="w-6 h-6 rounded-full" />
                  <span className="">Paperfly</span> Secrets
                </h3>
                <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  <p>Webhook URL: <code className="break-all font-semibold">{courierWebhookEndpoint('paperfly')}</code>. Paperfly sends the secret token in a verification header.</p>
                  <div className="space-y-2">
                    <label className="font-bold uppercase tracking-widest">Webhook secret token</label>
                    <input type="password" value={courierSettings.paperfly.webhookSecret} onChange={e => setCourierSettings({ ...courierSettings, paperfly: { ...courierSettings.paperfly, webhookSecret: e.target.value } })} className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3" placeholder="The secret key configured in Paperfly" />
                  </div>
                </div>
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
                <div className="space-y-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-bold text-gray-700">Paperfly Defaults</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Account</label>
                      <select
                        value={courierSettings.paperfly.defaultAccountId}
                        onChange={e => setCourierSettings({...courierSettings, paperfly: {...courierSettings.paperfly, defaultAccountId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Use system default</option>
                        {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Payment Method</label>
                      <select
                        value={courierSettings.paperfly.defaultPaymentMethod}
                        onChange={e => setCourierSettings({...courierSettings, paperfly: {...courierSettings.paperfly, defaultPaymentMethod: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Use system default</option>
                        {paymentMethods.map(pm => <option key={pm.id} value={pm.name}>{pm.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Expense Category (Shipping Costs)</label>
                      <select
                        value={courierSettings.paperfly.defaultExpenseCategoryId}
                        onChange={e => setCourierSettings({...courierSettings, paperfly: {...courierSettings.paperfly, defaultExpenseCategoryId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Shipping Costs (default)</option>
                        {categories.filter(c => c.type === 'Expense').map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Income Category (Delivery Payment)</label>
                      <select
                        value={courierSettings.paperfly.defaultIncomeCategoryId}
                        onChange={e => setCourierSettings({...courierSettings, paperfly: {...courierSettings.paperfly, defaultIncomeCategoryId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Sales Income (default)</option>
                        {categories.filter(c => c.type === 'Income').map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </section>
              )}

              {canUsePathao && (
              <section className="space-y-6">
                <h3 className="text-xl font-bold text-gray-800 border-b pb-4 flex items-center gap-2">
                  <img src="/uploads/pathao.png" alt="Pathao" className="w-6 h-6 rounded-full" />
                  <span className="">Pathao</span> Secrets
                </h3>
                <div className="space-y-3 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  <p>Webhook URL: <code className="break-all font-semibold">{courierWebhookEndpoint('pathao')}</code>. Configure this URL in the Pathao dashboard.</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="font-bold uppercase tracking-widest">Webhook header name</label>
                      <input type="text" value={courierSettings.pathao.webhookHeader} onChange={e => setCourierSettings({ ...courierSettings, pathao: { ...courierSettings.pathao, webhookHeader: e.target.value } })} className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3" placeholder="X-MamePilot-Webhook-Secret" />
                    </div>
                    <div className="space-y-2">
                      <label className="font-bold uppercase tracking-widest">Webhook header value</label>
                      <input type="password" value={courierSettings.pathao.webhookSecret} onChange={e => setCourierSettings({ ...courierSettings, pathao: { ...courierSettings.pathao, webhookSecret: e.target.value } })} className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3" placeholder="Shared secret value" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="font-bold uppercase tracking-widest">Merchant webhook integration secret</label>
                    <input type="password" value={courierSettings.pathao.merchantWebhookSecret} onChange={e => setCourierSettings({ ...courierSettings, pathao: { ...courierSettings.pathao, merchantWebhookSecret: e.target.value } })} className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3" placeholder="Integration handshake secret from Pathao dashboard" />
                    <p className="text-[10px] text-amber-600">This value is returned in the X-Pathao-Merchant-Webhook-Integration-Secret header during webhook integration setup.</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Base URL</label>
                    <input
                      type="text"
                      value={courierSettings.pathao.baseUrl}
                      onChange={e => setCourierSettings({ ...courierSettings, pathao: { ...courierSettings.pathao, baseUrl: e.target.value } })}
                      placeholder="https://merchant-api-live.pathao.com"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Client ID</label>
                      <input
                        type="text"
                        value={courierSettings.pathao.clientId}
                        onChange={e => setCourierSettings({ ...courierSettings, pathao: { ...courierSettings.pathao, clientId: e.target.value } })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Client Secret</label>
                      <input
                        type="text"
                        value={courierSettings.pathao.clientSecret}
                        onChange={e => setCourierSettings({ ...courierSettings, pathao: { ...courierSettings.pathao, clientSecret: e.target.value } })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Username</label>
                      <input
                        type="text"
                        value={courierSettings.pathao.username}
                        onChange={e => setCourierSettings({ ...courierSettings, pathao: { ...courierSettings.pathao, username: e.target.value } })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Password</label>
                      <input
                        type="text"
                        value={courierSettings.pathao.password}
                        onChange={e => setCourierSettings({ ...courierSettings, pathao: { ...courierSettings.pathao, password: e.target.value } })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Store ID</label>
                    <input
                      type="text"
                      value={courierSettings.pathao.storeId}
                      onChange={e => setCourierSettings({ ...courierSettings, pathao: { ...courierSettings.pathao, storeId: e.target.value } })}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Delivery Type</label>
                      <select
                        value={courierSettings.pathao.defaultDeliveryType}
                        onChange={e => setCourierSettings({ ...courierSettings, pathao: { ...courierSettings.pathao, defaultDeliveryType: parseInt(e.target.value) } })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value={48}>Normal (48h)</option>
                        <option value={12}>On Demand (12h)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Item Type</label>
                      <select
                        value={courierSettings.pathao.defaultItemType}
                        onChange={e => setCourierSettings({ ...courierSettings, pathao: { ...courierSettings.pathao, defaultItemType: parseInt(e.target.value) } })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value={2}>Parcel</option>
                        <option value={1}>Document</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Quantity</label>
                      <NumericInput
                        value={courierSettings.pathao.defaultQuantity ?? 1}
                        onChange={value => setCourierSettings({
                          ...courierSettings,
                          pathao: { ...courierSettings.pathao, defaultQuantity: Math.max(1, Math.round(value)) },
                        })}
                        className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Weight (kg)</label>
                      <NumericInput
                        value={courierSettings.pathao.defaultWeight ?? 1.0}
                        onChange={value => setCourierSettings({
                          ...courierSettings,
                          pathao: { ...courierSettings.pathao, defaultWeight: Math.max(0, value) },
                        })}
                        className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3"
                        allowDecimals={true}
                        decimalPlaces={2}
                      />
                    </div>
                  </div>
                  {courierSettings.pathao.accessToken && courierSettings.pathao.tokenExpiresAt && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs font-semibold text-blue-700">
                        Token Status:{' '}
                        {new Date(courierSettings.pathao.tokenExpiresAt).getTime() > Date.now()
                          ? <span className="text-green-700">Active (expires {formatDateTime(courierSettings.pathao.tokenExpiresAt)})</span>
                          : <span className="text-red-700">Expired</span>
                        }
                      </p>
                    </div>
                  )}
                </div>
                <div className="space-y-4 pt-4 border-t border-gray-100">
                  <h4 className="text-sm font-bold text-gray-700">Pathao Defaults</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Account</label>
                      <select
                        value={courierSettings.pathao.defaultAccountId}
                        onChange={e => setCourierSettings({...courierSettings, pathao: {...courierSettings.pathao, defaultAccountId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Use system default</option>
                        {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Default Payment Method</label>
                      <select
                        value={courierSettings.pathao.defaultPaymentMethod}
                        onChange={e => setCourierSettings({...courierSettings, pathao: {...courierSettings.pathao, defaultPaymentMethod: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Use system default</option>
                        {paymentMethods.map(pm => <option key={pm.id} value={pm.name}>{pm.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Expense Category (Shipping Costs)</label>
                      <select
                        value={courierSettings.pathao.defaultExpenseCategoryId}
                        onChange={e => setCourierSettings({...courierSettings, pathao: {...courierSettings.pathao, defaultExpenseCategoryId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Shipping Costs (default)</option>
                        {categories.filter(c => c.type === 'Expense').map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Income Category (Delivery Payment)</label>
                      <select
                        value={courierSettings.pathao.defaultIncomeCategoryId}
                        onChange={e => setCourierSettings({...courierSettings, pathao: {...courierSettings.pathao, defaultIncomeCategoryId: e.target.value}})}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl"
                      >
                        <option value="">Sales Income (default)</option>
                        {categories.filter(c => c.type === 'Income').map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </section>
              )}
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
                  {hasSubCapability('batch_management') && (
                    <option value="Batch">Batch</option>
                  )}
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

      {showModal === 'unit' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setShowModal(null)}></div>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 p-8 space-y-6">
            <h3 className="text-xl font-bold text-gray-900">Add Product Unit</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Unit Name</label>
                <input
                  type="text"
                  className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
                  value={unitForm.name}
                  onChange={e => setUnitForm({...unitForm, name: e.target.value})}
                  placeholder="e.g. Piece, Kilogram"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Short Name</label>
                <input
                  type="text"
                  className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
                  value={unitForm.shortName}
                  onChange={e => setUnitForm({...unitForm, shortName: e.target.value})}
                  placeholder="e.g. pc, kg"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Unit Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="unitType"
                      checked={!unitForm.isFraction}
                      onChange={() => setUnitForm({...unitForm, isFraction: false})}
                      className="w-4 h-4 text-[#3c5a82] focus:ring-[#3c5a82]"
                    />
                    <span className="text-sm font-medium text-gray-700">Integer (whole numbers)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="unitType"
                      checked={unitForm.isFraction}
                      onChange={() => setUnitForm({...unitForm, isFraction: true})}
                      className="w-4 h-4 text-[#3c5a82] focus:ring-[#3c5a82]"
                    />
                    <span className="text-sm font-medium text-gray-700">Fraction (decimals)</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <Button onClick={() => setShowModal(null)} variant="ghost" className="flex-1">Cancel</Button>
              <Button onClick={handleAddUnit} variant="primary" size="md" className="flex-1">Add Unit</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
