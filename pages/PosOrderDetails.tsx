import React, { useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { db } from '../db';
import { formatCurrency, getStatusColor, getStatusDisplayName } from '../constants';
import { useOrder, useCustomer, useProductImagesByIds, useCompanySettings, useInvoiceSettings, useSystemDefaults } from '../src/hooks/useQueries';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { LoadingOverlay } from '../components';
import { handlePrintOrder } from '../src/utils/printUtils';
import { getPreservedRouteState } from '../src/utils/navigation';
import { theme, mixThemeColorWithWhite, resolveThemeColorPalette } from '../theme';
import { formatDate } from '../utils';
import { CalendarDays, ReceiptText, UserRound, VenusAndMars, Weight, Droplets, MapPin } from 'lucide-react';
import { InvoiceContactIcon } from '../components/InvoiceContactIcon';
import { InvoiceLayout } from '../components';

const PosOrderDetails: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useRolePermissions();
  const { hasCapability, settings: capabilitySettings } = useCapabilities(Boolean(id));
  const isVaccineCenter = capabilitySettings?.businessMode === 'vaccine_center';

  const { data: order, isPending: orderLoading, error: orderError } = useOrder(id || '');
  const { data: customer } = useCustomer(order ? order.customerId : undefined);
  const { data: companySettings } = useCompanySettings();
  const { data: invoiceSettings } = useInvoiceSettings();
  const { data: systemDefaults } = useSystemDefaults();

  const orderItemProductIds = useMemo(
    () => Array.from(new Set((order?.items || []).map((item) => String(item?.productId || '').trim()).filter(Boolean))),
    [order?.items]
  );
  const { data: productImages = {} } = useProductImagesByIds(orderItemProductIds);

  const themeColorHex = useMemo(() => {
    const tc = systemDefaults?.themeColor || db.settings.defaults?.themeColor || '#0f2f57';
    return resolveThemeColorPalette(tc).primary;
  }, [systemDefaults?.themeColor]);

  const invoiceLogoWidth = Math.max(0, Number(invoiceSettings?.logoWidth || db.settings.invoice.logoWidth));
  const invoiceLogoHeight = Math.max(0, Number(invoiceSettings?.logoHeight || db.settings.invoice.logoHeight));
  const invoiceLogoStyle = {
    '--details-logo-mobile-width': `${Math.round(invoiceLogoWidth * 0.6)}px`,
    '--details-logo-mobile-height': `${Math.round(invoiceLogoHeight * 0.6)}px`,
    '--details-logo-tablet-width': `${Math.round(invoiceLogoWidth * 0.8)}px`,
    '--details-logo-tablet-height': `${Math.round(invoiceLogoHeight * 0.8)}px`,
    '--details-logo-width': `${invoiceLogoWidth}px`,
    '--details-logo-height': `${invoiceLogoHeight}px`,
  } as React.CSSProperties;

  const loading = orderLoading;
  const notFound = !orderLoading && !order && !orderError;

  const handleBack = () => {
    const navState = getPreservedRouteState(location.state);
    if (navState.backMode === 'history' && window.history.length > 1) {
      navigate(-1);
      return;
    }
    const from = navState.from;
    if (from) {
      navigate(from);
    } else {
      navigate('/pos-sales');
    }
  };

  if (orderError || notFound) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <p className="text-gray-500 text-sm font-bold">Order not found.</p>
            <button onClick={handleBack} className="px-4 py-2 text-sm font-bold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">
              Back to POS Sales
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (order && order.isPos === false) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <p className="text-gray-500 text-sm font-bold">This is not a POS order.</p>
            <button onClick={() => navigate(`/orders/${id}`)} className="px-4 py-2 text-sm font-bold text-[#0f2f57] border border-[#0f2f57] rounded-lg hover:bg-[#0f2f57] hover:text-white transition-all">
              View in Orders
            </button>
          </div>
        </div>
      </div>
    );
  }

  const changeReturned = Math.max((order?.paidAmount || 0) - (order?.total || 0), 0);

  const invoiceItems = (order?.items ?? []).map((item, idx) => {
    const fallbackImage = typeof (item as any)?.productImage === 'string' ? (item as any).productImage : typeof (item as any)?.image === 'string' ? (item as any).image : '';
    const imageSrc = fallbackImage || productImages[String(item.productId || '').trim()] || '';
    const returnedQty = item.returnedQty ?? 0;
    const exchangedQty = item.exchangedQty ?? 0;
    const activeQty = Math.max(0, item.quantity - returnedQty - exchangedQty);
    const isFullyReturned = activeQty === 0;

    return {
      id: idx,
      name: item.productName,
      rate: formatCurrency(item.rate),
      quantity: activeQty,
      total: formatCurrency(item.rate * activeQty),
      image: imageSrc || undefined,
      muted: isFullyReturned,
      badge: (returnedQty > 0 || exchangedQty > 0) ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {returnedQty > 0 && (
            <span className="inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[8px] font-bold text-orange-700">
              Returned ×{returnedQty}
            </span>
          )}
          {exchangedQty > 0 && (
            <span
              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[8px] font-bold"
              style={{ backgroundColor: mixThemeColorWithWhite(themeColorHex, 0.88), color: themeColorHex }}
            >
              Exchanged ×{exchangedQty}
            </span>
          )}
        </div>
      ) : undefined,
    };
  });

  const invoiceTotals = [
    { label: 'Subtotal', value: formatCurrency(order?.subtotal ?? 0), tone: 'theme' as const },
    ...(order && order.discount > 0 ? [{ label: 'Discount', value: `-${formatCurrency(order.discount)}`, tone: 'success' as const }] : []),
    ...(order && Number(order.vatAmount || 0) > 0 ? [{ label: `Tax (${order.vatRate || 0}%)`, value: formatCurrency(order.vatAmount || 0), tone: 'muted' as const }] : []),
    { label: 'Net Total', value: formatCurrency(order?.total ?? 0), tone: 'default' as const },
    ...(order ? [{ label: 'Amount Paid', value: formatCurrency(order.paidAmount), tone: 'success' as const }] : []),
    ...(changeReturned > 0 ? [{ label: 'Change Returned', value: formatCurrency(changeReturned), tone: 'success' as const }] : []),
  ];

  const invoiceCustomerBlocks = isVaccineCenter ? (
    <div className="mt-4 grid grid-cols-[minmax(130px,1.2fr)_repeat(4,minmax(68px,1fr))] items-center gap-y-3">
      <div className="min-w-0 pr-3">
        <h3 className="text-[11px] font-black text-slate-900 break-words sm:text-xs lg:text-sm">
          {customer?.name || order?.customerName || 'Walk-in Patient'}
        </h3>
        <p className="mt-0.5 text-[9px] font-medium text-gray-500 sm:text-[10px]">{customer?.phone || 'N/A'}</p>
      </div>
      {([
        ['Age', customer?.age ?? 'N/A', CalendarDays],
        ['Gender', customer?.gender || 'N/A', VenusAndMars],
        ['Weight', customer?.weight != null ? `${customer.weight} kg` : 'N/A', Weight],
        ['Blood group', customer?.bloodGroup || 'N/A', Droplets],
      ] as Array<[string, string, React.ElementType]>).map(([label, value, FactIcon]) => (
        <div key={String(label)} className="flex min-w-0 items-center gap-1.5 border-l border-gray-200 px-2">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: mixThemeColorWithWhite(themeColorHex, 0.86), color: themeColorHex }}>
            {React.createElement(FactIcon, { size: 14 })}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[8px] font-medium text-gray-500 sm:text-[9px]">{String(label)}</p>
            <p className="truncate text-[10px] font-black text-slate-900 sm:text-xs">{String(value)}</p>
          </div>
        </div>
      ))}
    </div>
  ) : undefined;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <LoadingOverlay isLoading={loading && !order} message="Loading order details..." />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500 transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          {order && (
            <>
              <h2 className="text-md md:text-lg font-bold text-gray-900">{order.orderNumber}</h2>
              <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${getStatusColor(order.status)}`}>
                {getStatusDisplayName(order.status)}
              </span>
            </>
          )}
        </div>

        {order && (
          <button
            onClick={() => handlePrintOrder(id!, navigate)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold border rounded-lg bg-white hover:bg-gray-50 transition-all shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
            Print
          </button>
        )}
      </div>

      {order && (
        <InvoiceLayout
          className="lg:col-span-2"
          contentClassName="p-4 sm:p-6 md:p-8 lg:p-10 space-y-4 sm:space-y-5"
          themeColorHex={themeColorHex}
          company={{
            name: companySettings?.name || db.settings.company.name,
            tagline: companySettings?.tagline || db.settings.company.tagline,
            phone: companySettings?.phone || db.settings.company.phone,
            email: companySettings?.email || db.settings.company.email,
            address: companySettings?.address || db.settings.company.address,
            logo: companySettings?.logo || db.settings.company.logo,
          }}
          invoiceNumber={order.orderNumber}
          invoiceNumberLabel="Order No."
          invoiceDate={formatDate(order.orderDate)}
          invoiceDateLabel="Date"
          customer={{
            name: customer?.name || order.customerName || 'Walk-in Customer',
            phone: customer?.phone || 'N/A',
            address: customer?.address || 'N/A',
          }}
          customerTitle={isVaccineCenter ? 'Patient Details' : 'Billed To'}
          customerAddressLabel="Address"
          customerAddress={customer?.address || 'N/A'}
          items={invoiceItems}
          totals={invoiceTotals}
          notes={order.notes || ''}
          footer={invoiceSettings?.footer || ''}
          customerDetailBlocks={invoiceCustomerBlocks}
        />
      )}
    </div>
  );
};

export default PosOrderDetails;
