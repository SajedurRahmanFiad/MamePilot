import React, { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../db';
import { formatCurrency } from '../constants';
import { triggerPrintDialog } from '../src/utils/printUtils';
import { useBill, useVendor, useProductImagesByIds, useCompanySettings, useInvoiceSettings, useSystemDefaults } from '../src/hooks/useQueries';
import { resolveThemeColorPalette } from '../theme';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { formatDate } from '../utils';

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
  return (
    <div className="space-y-5 print:space-y-4 text-gray-900">
      <div className="flex justify-between items-start">
        <div>
          {(companySettings?.logo || db.settings.company.logo) && (
            <img
              src={companySettings?.logo || db.settings.company.logo}
              className="rounded-lg object-cover mb-4"
              style={{
                width: invoiceSettings?.logoWidth || db.settings.invoice.logoWidth,
                height: invoiceSettings?.logoHeight || db.settings.invoice.logoHeight,
              }}
              alt="Company Logo"
            />
          )}
          <h1 className="text-xl font-black uppercase tracking-tighter" style={{ color: themeColorHex }}>
            {companySettings?.name || db.settings.company.name}
          </h1>
          <div className="mt-2 text-xs text-gray-400 font-medium space-y-1 print:text-gray-600">
            <p>{companySettings?.address || db.settings.company.address}</p>
            <p>
              {companySettings?.phone || db.settings.company.phone} |{' '}
              {companySettings?.email || db.settings.company.email}
            </p>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-3xl font-black text-gray-300 uppercase leading-none mb-2 print:text-gray-400">
            {invoiceSettings?.title || db.settings.invoice.title}
          </h2>
          <div className="space-y-1.5 print:space-y-1">
            <p className="text-sm font-bold text-gray-900 print:text-gray-800">
              <span className="text-gray-400 font-medium">Bill No:&nbsp;&nbsp;</span>
              #{bill.billNumber}
            </p>
            <p className="text-sm font-bold text-gray-900 print:text-gray-800">
              <span className="text-gray-400 font-medium">Date:&nbsp;&nbsp;</span>
              {formatDate(bill.billDate)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-12 border-t border-gray-100 py-4 print:border-gray-300 print:py-3">
        <div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4 print:mb-2">
            Bill From
          </p>
          <h3 className="text-md font-black text-gray-900 print:text-gray-800">{vendor?.name}</h3>
          <p className="text-sm text-gray-500 leading-relaxed print:text-gray-600">{vendor?.address}</p>
          <p className="text-sm font-bold mt-2 print:mt-1">{vendor?.phone}</p>
        </div>
      </div>

      <table className="w-full text-left print:text-gray-800">
        <thead>
          <tr className="border-b-2 border-gray-100 print:border-gray-300">
            <th className="py-4 text-sm font-black text-gray-400 uppercase print:text-xs print:py-2">
              Description
            </th>
            <th className="py-4 text-sm text-center font-black text-gray-400 uppercase print:text-xs print:py-2">
              Cost
            </th>
            <th className="py-4 text-sm text-center font-black text-gray-400 uppercase print:text-xs print:py-2">
              Qty
            </th>
            <th className="py-4 text-sm text-right font-black text-gray-400 uppercase print:text-xs print:py-2">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 print:divide-gray-300">
          {bill.items.map((item: any, idx: number) => {
            const fallbackItemImage =
              typeof item?.productImage === 'string'
                ? item.productImage
                : typeof item?.image === 'string'
                  ? item.image
                  : '';
            const imageSrc = fallbackItemImage || productImages[String(item.productId || '').trim()] || '';

            return (
              <tr key={idx} className="group">
                <td className="py-6 print:py-3">
                  <div className="flex items-center gap-4">
                    {imageSrc ? (
                      <img
                        src={imageSrc}
                        className="w-12 h-12 rounded-full object-cover border border-gray-100 shadow-sm print:w-10 print:h-10 print:rounded-full print:border-gray-300 print:shadow-none"
                        alt={item.productName}
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full border border-gray-100 shadow-sm bg-gray-50 text-gray-400 text-sm flex items-center justify-center print:w-10 print:h-10 print:rounded-full print:border-gray-300 print:shadow-none">
                        {(item.productName || '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span className="font-bold text-gray-900 print:text-sm">{item.productName}</span>
                  </div>
                </td>
                <td className="py-6 text-center text-gray-500 font-bold print:py-3 print:text-sm">
                  {formatCurrency(item.rate)}
                </td>
                <td className="py-6 text-center text-gray-500 font-bold print:py-3 print:text-sm">
                  {item.quantity}
                </td>
                <td className="py-6 text-right font-black text-gray-900 print:py-3 print:text-sm">
                  {formatCurrency(item.amount)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex justify-end pt-6 print:pt-4">
        <div className="w-full max-w-xs space-y-4 print:space-y-2 print:text-sm">
          <div className="flex justify-between text-sm print:text-xs">
            <span className="text-gray-400 font-bold uppercase print:text-gray-600">Subtotal</span>
            <span className="font-bold text-gray-900 print:text-gray-800">{formatCurrency(bill.subtotal)}</span>
          </div>
          {bill.discount > 0 && (
            <div className="flex justify-between text-sm print:text-xs">
              <span className="text-gray-400 font-bold uppercase print:text-gray-600">Discount</span>
              <span className="font-bold text-emerald-600 print:text-emerald-600">-{formatCurrency(bill.discount)}</span>
            </div>
          )}
          {bill.shipping > 0 && (
            <div className="flex justify-between text-sm print:text-xs">
              <span className="text-gray-400 font-bold uppercase print:text-gray-600">Shipping</span>
              <span className="font-bold text-gray-900 print:text-gray-800">{formatCurrency(bill.shipping)}</span>
            </div>
          )}
          <div className="flex justify-between items-center py-6 border-t-2 border-[#0f2f57] print:py-3 print:border-t print:border-gray-400">
            <span className="font-black text-gray-900 uppercase tracking-tighter text-sm print:text-sm print:text-gray-800">
              Total Payable
            </span>
            <span className="font-black text-gray-900 text-sm print:text-sm print:text-gray-800">{formatCurrency(bill.total)}</span>
          </div>
        </div>
      </div>

      {bill.notes && (
        <div className="bg-gray-50 p-4 rounded-[10px] border border-gray-100 print:bg-white print:p-3 print:rounded-lg print:border-gray-300">
          <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-2 print:text-gray-500 print:mb-1">
            Terms & Notes
          </p>
          <p className="text-xs text-gray-600 font-medium italic leading-relaxed print:text-gray-700">
            {bill.notes}
          </p>
        </div>
      )}
    </div>
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
      <div className="space-y-0 print:space-y-0">
        <div className="bg-white p-6 lg:p-10 print:p-6 min-h-screen print:min-h-fit">
          <BillInvoiceContent
            bill={bill}
            vendor={vendor}
            productImages={productImages}
            companySettings={companySettings}
            invoiceSettings={invoiceSettings}
            themeColorHex={themeColorHex}
          />
        </div>

        <div className="bg-white p-6 lg:p-10 print:p-6 min-h-screen print:min-h-fit" style={{ pageBreakBefore: 'always' }}>
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
