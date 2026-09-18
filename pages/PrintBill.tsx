import React, { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../db';
import { formatCurrency } from '../constants';
import { triggerPrintDialog } from '../src/utils/printUtils';
import { useBill, useVendor, useProductImagesByIds, useCompanySettings, useInvoiceSettings, useSystemDefaults } from '../src/hooks/useQueries';
import { resolveThemeColorPalette } from '../theme';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { formatDate } from '../utils';
import { ReceiptText } from 'lucide-react';
import { InvoiceLayout } from '../components';

interface BillInvoiceContentProps {
  bill: any;
  vendor: any;
  productImages: Record<string, string>;
  companySettings: any;
  invoiceSettings: any;
  themeColorHex: string;
}

const BillInvoiceContent: React.FC<BillInvoiceContentProps> = ({
  bill,
  vendor,
  productImages,
  companySettings,
  invoiceSettings,
  themeColorHex,
}) => {
  const billItems = bill?.items || [];

  const invoiceItems = (bill?.items ?? []).map((item: any, index: number) => {
    const fallbackItemImage = typeof item?.productImage === 'string' ? item.productImage : typeof item?.image === 'string' ? item.image : '';
    const imageSrc = fallbackItemImage || productImages[String(item.productId || '').trim()] || '';
    const returnedQty = item.returnedQty ?? 0;
    const activeQty = Math.max(0, item.quantity - returnedQty);
    const isFullyReturned = activeQty === 0;

    return {
      id: item.id ?? index,
      name: item.productName,
      rate: formatCurrency(item.rate),
      quantity: activeQty,
      total: formatCurrency(item.rate * activeQty),
      image: imageSrc || undefined,
      muted: isFullyReturned,
      badge: returnedQty > 0 ? (
        <div className="mt-0.5">
          <span className="inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[8px] font-bold text-orange-700">
            Returned ×{returnedQty}
          </span>
        </div>
      ) : undefined,
    };
  });

  const invoiceTotals = [
    { label: 'Subtotal', value: formatCurrency(bill?.subtotal ?? 0), tone: 'theme' as const },
    ...(bill && bill.discount > 0 ? [{ label: 'Discount', value: `-${formatCurrency(bill.discount)}`, tone: 'success' as const }] : []),
    ...(bill && bill.shipping > 0 ? [{ label: 'Shipping', value: formatCurrency(bill.shipping), tone: 'muted' as const }] : []),
    { label: 'Total Payable', value: formatCurrency(bill?.total ?? 0), tone: 'default' as const },
  ];

  return (
    <InvoiceLayout
      className="print:min-h-fit"
      contentClassName="p-6 lg:p-10 print:p-6 min-h-screen print:min-h-fit space-y-3 sm:space-y-4 lg:space-y-5"
      themeColorHex={themeColorHex}
      company={{
        name: companySettings?.name || db.settings.company.name,
        tagline: companySettings?.tagline || db.settings.company.tagline,
        phone: companySettings?.phone || db.settings.company.phone,
        email: companySettings?.email || db.settings.company.email,
        address: companySettings?.address || db.settings.company.address,
        logo: companySettings?.logo || db.settings.company.logo,
      }}
      invoiceNumber={`#${bill.billNumber}`}
      invoiceNumberLabel="Bill No."
      invoiceDate={formatDate(bill.billDate)}
      invoiceDateLabel="Date"
      customer={{
        name: vendor?.name || 'Vendor',
        phone: vendor?.phone || 'N/A',
        address: vendor?.address || 'N/A',
      }}
      customerTitle="Billed To"
      customerAddressLabel="Address"
      customerAddress={vendor?.address || 'N/A'}
      items={invoiceItems}
      totals={invoiceTotals}
      notes={bill.notes || ''}
      footer={invoiceSettings?.footer || ''}
    />
  );
};

const PrintBill: React.FC = () => {
  const { id } = useParams();
  const { canPrintBills } = useRolePermissions();
  const { data: bill, isPending: billLoading } = useBill(id || '');
  const { data: vendor, isPending: vendorLoading } = useVendor(bill ? bill.vendorId : undefined);
  const billItemProductIds = useMemo(
    () => Array.from(new Set((bill?.items || []).map((item: any) => String(item?.productId || '').trim()).filter(Boolean))),
    [bill?.items]
  );
  const { data: productImages = {} } = useProductImagesByIds(billItemProductIds);
  const { data: companySettings, isPending: companySettingsLoading } = useCompanySettings();
  const { data: invoiceSettings, isPending: invoiceSettingsLoading } = useInvoiceSettings();
  const { data: systemDefaults } = useSystemDefaults();
  const printTriggeredRef = useRef(false);
  const themeColorHex = useMemo(() => {
    const tc = systemDefaults?.themeColor || db.settings.defaults?.themeColor || '#0f2f57';
    return resolveThemeColorPalette(tc).primary;
  }, [systemDefaults?.themeColor]);
  const invoiceLoading = billLoading || vendorLoading || companySettingsLoading || invoiceSettingsLoading;

  useEffect(() => {
    if (bill && !invoiceLoading && !printTriggeredRef.current) {
      printTriggeredRef.current = true;
      triggerPrintDialog();
    }
  }, [bill, invoiceLoading]);

  if (!canPrintBills) {
    return <div className="p-8 text-center text-gray-500">You don't have permission to print bills.</div>;
  }

  if (invoiceLoading) {
    return <div className="p-8 text-center text-gray-500">Loading details...</div>;
  }

  if (!bill) {
    return <div className="p-8 text-center text-gray-500">Bill not found.</div>;
  }

  return (
    <div className="min-h-screen bg-white print:bg-white">
      <div className="space-y-4 print:space-y-4">
        <BillInvoiceContent
          bill={bill}
          vendor={vendor}
          productImages={productImages}
          companySettings={companySettings}
          invoiceSettings={invoiceSettings}
          themeColorHex={themeColorHex}
        />

        <div style={{ pageBreakBefore: 'always' }}>
          <BillInvoiceContent
            bill={bill}
            vendor={vendor}
            productImages={productImages}
            companySettings={companySettings}
            invoiceSettings={invoiceSettings}
            themeColorHex={themeColorHex}
          />
        </div>
      </div>

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
          .print\\:page-break-avoid {
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

export default PrintBill;
