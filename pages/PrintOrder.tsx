import React, { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../db';
import { formatCurrency } from '../constants';
import { triggerPrintDialog } from '../src/utils/printUtils';
import { useOrder, useCustomer, useProductImagesByIds, useCompanySettings, useInvoiceSettings, useSystemDefaults } from '../src/hooks/useQueries';
import { mixThemeColorWithWhite, resolveThemeColorPalette } from '../theme';
import { getOrderCompanyPage } from '../src/utils/companyPages';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { formatDate } from '../utils';
import { CalendarDays, ReceiptText, UserRound, VenusAndMars, Weight, Droplets, MapPin } from 'lucide-react';
import { InvoiceContactIcon } from '../components/InvoiceContactIcon';
import { InvoiceLayout } from '../components';

interface InvoiceContentProps {
  order: any;
  customer: any;
  productImages: Record<string, string>;
  branding: any;
  invoiceSettings: any;
  themeColorHex: string;
  isVaccineCenter: boolean;
}

const InvoiceContent: React.FC<InvoiceContentProps> = ({
  order,
  customer,
  productImages,
  branding,
  invoiceSettings,
  themeColorHex,
  isVaccineCenter,
}) => {
  const orderItems = order?.items || [];
  const weightUnit = 'kg';
  const weightLabel = weightUnit;

  const invoiceItems = (order?.items ?? []).map((item: any, index: number) => {
    const fallbackItemImage = typeof item?.productImage === 'string' ? item.productImage : typeof item?.image === 'string' ? item.image : '';
    const imageSrc = fallbackItemImage || productImages[String(item.productId || '').trim()] || '';
    const returnedQty = item.returnedQty ?? 0;
    const exchangedQty = item.exchangedQty ?? 0;
    const activeQty = Math.max(0, item.quantity - returnedQty - exchangedQty);
    const isFullyReturned = activeQty === 0;

    return {
      id: item.id ?? index,
      name: item.productName,
      rate: formatCurrency(item.rate),
      quantity: activeQty,
      total: formatCurrency(item.rate * activeQty),
      image: imageSrc || undefined,
      muted: isFullyReturned,
      badge: returnedQty > 0 || exchangedQty > 0 ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {returnedQty > 0 && <span className="inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[8px] font-bold text-orange-700">Returned ×{returnedQty}</span>}
          {exchangedQty > 0 && <span className="inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[8px] font-bold text-blue-700">Exchanged ×{exchangedQty}</span>}
        </div>
      ) : undefined,
    };
  });

  const invoiceTotals = [
    { label: 'Subtotal', value: formatCurrency(order?.subtotal ?? 0), tone: 'theme' as const },
    ...(order && !isVaccineCenter && order.discount > 0 ? [{ label: 'Discount', value: `-${formatCurrency(order.discount)}`, tone: 'success' as const }] : []),
    ...(order && !isVaccineCenter && order.shipping > 0 ? [{ label: 'Shipping', value: formatCurrency(order.shipping), tone: 'muted' as const }] : []),
    { label: 'Net Total', value: formatCurrency(order?.total ?? 0), tone: 'default' as const },
  ];

  const customerDetailBlocks = isVaccineCenter ? (
    <div className="mt-4 grid grid-cols-[minmax(125px,1.2fr)_repeat(5,minmax(58px,1fr))] items-center">
      <div className="min-w-0 pr-3">
        <h3 className="text-[11px] font-black text-slate-900 break-words sm:text-xs lg:text-sm">{customer?.name}</h3>
        <p className="mt-0.5 text-[9px] font-medium text-gray-500 sm:text-[10px]">{customer?.phone}</p>
      </div>
      {([
        ['Age', customer?.age ?? 'N/A', CalendarDays],
        ['Gender', customer?.gender || 'N/A', VenusAndMars],
        ['Weight', customer?.weight != null ? `${customer.weight} ${weightLabel}` : 'N/A', Weight],
        ['Height', customer?.height ? `${customer.height} ${weightUnit}` : 'N/A', UserRound],
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
    <InvoiceLayout
      className="print:min-h-fit"
      contentClassName="p-6 lg:p-10 print:p-6 min-h-screen print:min-h-fit space-y-3 sm:space-y-4 lg:space-y-5"
      themeColorHex={themeColorHex}
      company={{
        name: branding?.name || db.settings.company.name,
        tagline: branding?.tagline || db.settings.company.tagline,
        phone: branding?.phone || db.settings.company.phone,
        email: branding?.email || db.settings.company.email,
        address: branding?.address || db.settings.company.address,
        logo: branding?.logo || db.settings.company.logo,
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
      customerDetailBlocks={customerDetailBlocks}
    />
  );
};

const PrintOrder: React.FC = () => {
  const { id } = useParams();
  const { canPrintOrders } = useRolePermissions();
  const { settings: capabilitySettings } = useCapabilities(Boolean(id));
  const { data: order, isPending: orderLoading } = useOrder(id || '');
  const { data: customer } = useCustomer(order ? order.customerId : undefined);
  const orderItemProductIds = useMemo(
    () => Array.from(new Set((order?.items || []).map((item: any) => String(item?.productId || '').trim()).filter(Boolean))),
    [order?.items]
  );
  const { data: productImages = {} } = useProductImagesByIds(orderItemProductIds);
  const { data: companySettings } = useCompanySettings();
  const { data: invoiceSettings } = useInvoiceSettings();
  const { data: systemDefaults } = useSystemDefaults();
  const isVaccineCenter = capabilitySettings?.businessMode === 'vaccine_center';
  const printTriggeredRef = useRef(false);
  const orderBranding = useMemo(
    () => getOrderCompanyPage(order, companySettings || db.settings.company),
    [companySettings, order],
  );
  const themeColorHex = useMemo(() => {
    const tc = systemDefaults?.themeColor || db.settings.defaults?.themeColor || '#0f2f57';
    return resolveThemeColorPalette(tc).primary;
  }, [systemDefaults?.themeColor]);
  // Trigger print dialog when order data is loaded (only once)
  useEffect(() => {
    if (order && !orderLoading && !printTriggeredRef.current) {
      printTriggeredRef.current = true;
      triggerPrintDialog();
    }
  }, [order, orderLoading]);

  if (!canPrintOrders) {
    return <div className="p-8 text-center text-gray-500">You don't have permission to print orders.</div>;
  }

  if (orderLoading) {
    return <div className="p-8 text-center text-gray-500">Loading details...</div>;
  }

  if (!order) {
    return <div className="p-8 text-center text-gray-500">Order not found.</div>;
  }

  return (
    <div className="min-h-screen bg-white print:bg-white">
      {/* Two-Invoice Stacked Layout (one below another) */}
      <div className="space-y-4 print:space-y-4">
        <InvoiceContent
          order={order}
          customer={customer}
          productImages={productImages}
          branding={orderBranding}
          invoiceSettings={invoiceSettings}
          themeColorHex={themeColorHex}
          isVaccineCenter={isVaccineCenter}
        />

        <div style={{ pageBreakBefore: 'always' }}>
          <InvoiceContent
            order={order}
            customer={customer}
            productImages={productImages}
            branding={orderBranding}
            invoiceSettings={invoiceSettings}
            themeColorHex={themeColorHex}
            isVaccineCenter={isVaccineCenter}
          />
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body {
            margin: 0;
            padding: 0;
            background: white;
          }
          .no-print {
            display: none !important;
          }
          .print-invoice-root {
            font-size: 16px !important;
          }
          .print-brand-name {
            font-size: 24px !important;
          }
          .print-tagline {
            font-size: 13px !important;
          }
          .print-company-meta {
            font-size: 12px !important;
          }
          .print-invoice-title {
            font-size: 28px !important;
          }
          .print-meta-label {
            font-size: 11px !important;
          }
          .print-meta-value {
            font-size: 13px !important;
          }
          .print-section-heading {
            font-size: 16px !important;
          }
          .print-customer-name {
            font-size: 16px !important;
          }
          .print-customer-sub,
          .print-address-label,
          .print-address-value,
          .print-table-label,
          .print-table-note,
          .print-table-value,
          .print-total-label,
          .print-total-value,
          .print-item-name,
          .print-item-pill,
          .print-notes-label,
          .print-notes-text,
          .print-footer-text,
          .print-table-head,
          .print-table-cell {
            font-size: inherit !important;
          }
          .print-address-value,
          .print-table-value,
          .print-item-name,
          .print-total-value {
            font-size: 13px !important;
          }
          .print-table-head {
            font-size: 12px !important;
          }
          .print-table-cell,
          .print-item-pill,
          .print-table-note {
            font-size: 11.5px !important;
          }
          .print-item-name {
            font-size: 14px !important;
          }
          .print-total-label {
            font-size: 11.5px !important;
          }
          .print-notes-label {
            font-size: 10.5px !important;
          }
          .print-notes-text,
          .print-footer-text {
            font-size: 12px !important;
          }
          table {
            page-break-inside: avoid;
          }
          tr {
            page-break-inside: avoid;
          }
          @page {
            margin: 0.25in;
            size: A4;
          }
          .print\:page-break-avoid {
            page-break-inside: avoid;
          }
          .grid {
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
};

export default PrintOrder;
