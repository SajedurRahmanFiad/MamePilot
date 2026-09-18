import React, { type CSSProperties, type ReactNode } from 'react';
import { CalendarDays, MapPin, ReceiptText, UserRound } from 'lucide-react';
import { mixThemeColorWithWhite } from '../theme';

export interface InvoiceCompanyInfo {
  name?: string;
  tagline?: string;
  phone?: string;
  email?: string;
  address?: string;
  logo?: string;
}

export interface InvoiceCustomerInfo {
  name?: string;
  phone?: string;
  address?: string;
}

export interface InvoiceItemRow {
  id?: string | number;
  name: string;
  rate: number | string;
  quantity: number | string;
  total: number | string;
  image?: string;
  badge?: ReactNode;
  muted?: boolean;
}

export interface InvoiceTotalRow {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'theme' | 'muted';
}

interface InvoiceLayoutProps {
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
  style?: CSSProperties;

  company?: InvoiceCompanyInfo;
  invoiceNumber?: string;
  invoiceNumberLabel?: string;
  invoiceDate?: string;
  invoiceDateLabel?: string;
  themeColorHex?: string;
  logoWidth?: number;
  logoHeight?: number;

  customer?: InvoiceCustomerInfo;
  customerTitle?: string;
  customerSubtitle?: ReactNode;
  customerAddressLabel?: string;
  customerAddress?: string;
  customerDetailBlocks?: ReactNode;

  items?: InvoiceItemRow[];
  hideRowNumbersOnMobile?: boolean;
  renderItemRow?: (item: InvoiceItemRow, index: number) => ReactNode;

  totals?: InvoiceTotalRow[];
  notes?: string;
  footer?: string;

  brandBlock?: ReactNode;
  metadataBlock?: ReactNode;
  customerBlock?: ReactNode;
  tableBlock?: ReactNode;
  totalsBlock?: ReactNode;
  notesBlock?: ReactNode;
  footerBlock?: ReactNode;
}

const defaultMetaLabelClass = 'text-[9px] sm:text-[10px] lg:text-[11px] font-semibold text-gray-500';
const defaultMetaValueClass = 'mt-0.5 text-[10px] sm:text-[11px] lg:text-sm font-black text-slate-900 break-all';

export const InvoiceLayout: React.FC<InvoiceLayoutProps> = ({
  children,
  className = '',
  contentClassName = 'p-3 sm:p-4 md:p-6 lg:p-10 space-y-3 sm:space-y-4 lg:space-y-5',
  style,
  company,
  invoiceNumber,
  invoiceNumberLabel = 'Invoice No.',
  invoiceDate,
  invoiceDateLabel = 'Date',
  themeColorHex = '#0f2f57',
  logoWidth = 64,
  logoHeight = 64,
  customer,
  customerTitle = 'Billed To',
  customerSubtitle,
  customerAddressLabel = 'Address',
  customerAddress,
  customerDetailBlocks,
  items = [],
  hideRowNumbersOnMobile = true,
  renderItemRow,
  totals = [],
  notes,
  footer,
  brandBlock,
  metadataBlock,
  customerBlock,
  tableBlock,
  totalsBlock,
  notesBlock,
  footerBlock,
}) => {
  const hasTemplateSections = Boolean(
    brandBlock ||
      metadataBlock ||
      customerBlock ||
      tableBlock ||
      totalsBlock ||
      notesBlock ||
      footerBlock ||
      company ||
      invoiceNumber ||
      invoiceDate ||
      customer ||
      items.length ||
      totals.length ||
      notes ||
      footer
  );

  const invoiceLogoStyle = {
    width: `${logoWidth}px`,
    height: `${logoHeight}px`,
    maxWidth: '100%',
    maxHeight: '100%',
  } as CSSProperties;

  const renderDefaultItemRow = (item: InvoiceItemRow, index: number) => (
    <tr key={item.id ?? `${item.name}-${index}`} className={`group align-middle ${item.muted ? 'opacity-50' : ''}`}>
      <td className={`${hideRowNumbersOnMobile ? 'hidden sm:table-cell' : 'table-cell'} py-3 sm:py-4 lg:py-5 px-2 sm:px-3 text-center font-bold text-gray-500`}>
        {index + 1}
      </td>
      <td className="py-3 sm:py-4 lg:py-5 px-2 sm:px-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 lg:gap-3">
          {item.image ? (
            <img src={item.image} className={`invoice-item-image h-7 w-7 rounded-full border border-gray-100 object-cover shadow-sm sm:h-8 sm:w-8 lg:h-10 lg:w-10 ${item.muted ? 'grayscale' : ''}`} alt={item.name} />
          ) : (
            <div className={`invoice-item-image flex h-7 w-7 items-center justify-center rounded-full border border-gray-100 text-[9px] font-black shadow-sm sm:h-8 sm:w-8 lg:h-10 lg:w-10 ${item.muted ? 'grayscale' : ''}`} style={{ backgroundColor: '#f6f8fc', color: themeColorHex }}>
              {(item.name || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="invoice-address-content flex min-w-0 flex-col gap-0">
            <span className={`invoice-item-name block break-words text-[11px] font-bold sm:text-[12px] lg:text-[13px] ${item.muted ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{item.name}</span>
            {item.badge && <div className="invoice-item-badge mt-0.5">{item.badge}</div>}
          </div>
        </div>
      </td>
      <td className="invoice-item-rate px-1 py-3 text-center text-[11px] font-bold text-gray-500 whitespace-nowrap sm:py-4 sm:text-[12px] lg:py-5 lg:text-[13px]">{item.rate}</td>
      <td className="px-1 py-3 text-center whitespace-nowrap sm:py-4 lg:py-5">
        <span className={`text-[11px] font-bold sm:text-[12px] lg:text-[13px] ${item.muted ? 'text-gray-400 line-through' : 'text-gray-500'}`}>{item.quantity}</span>
      </td>
      <td className="px-2 py-3 text-right whitespace-nowrap sm:px-3 sm:py-4 lg:py-5">
        <span className={`invoice-item-total text-[11px] font-black sm:text-[12px] lg:text-[13px] ${item.muted ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{item.total}</span>
      </td>
    </tr>
  );

  const renderDefaultCustomer = (
    <div className="invoice-customer-section rounded-lg px-4 py-4" style={{ backgroundColor: `${themeColorHex}12` }}>
      <div className="invoice-customer-title flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500 sm:text-[11px]">
        <UserRound size={14} fill="currentColor" style={{ color: themeColorHex }} />
        {customerTitle}
      </div>

      <div className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-0">
        <div className="min-w-0 pr-3">
          <h3 className="invoice-customer-name text-[11px] font-black text-slate-900 break-words sm:text-xs lg:text-sm">{customer?.name || 'Walk-in Customer'}</h3>
          {customerSubtitle ?? (customer?.phone ? <p className="invoice-customer-sub mt-0.5 text-[9px] font-medium text-gray-500 sm:text-[10px]">{customer.phone}</p> : null)}
        </div>

        <div className="flex min-w-0 items-start gap-1.5 border-l border-gray-200 pl-3">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${themeColorHex}1a`, color: themeColorHex }}>
            <MapPin size={14} />
          </span>
          <div className="invoice-address-content flex min-w-0 flex-col gap-0" style={{ rowGap: 0 }}>
            <p className="invoice-address-label m-0 text-[8px] font-medium leading-tight text-gray-500 sm:text-[9px]" style={{ margin: 0, lineHeight: 1.1 }}>{customerAddressLabel}</p>
            <p className="invoice-address-value m-0 text-[10px] font-black leading-tight text-slate-900 whitespace-pre-line sm:text-xs" style={{ margin: 0, lineHeight: 1.1 }}>{String(customerAddress || customer?.address || 'N/A').trim()}</p>
          </div>
        </div>
      </div>

      {customerDetailBlocks}
    </div>
  );

  const renderDefaultTable = (
    <div className="overflow-x-auto -mx-3 sm:-mx-4 md:-mx-6 lg:-mx-10">
      <div className="px-3 sm:px-4 md:px-6 lg:px-10">
        <table className="invoice-item-table w-full border border-gray-200 border-collapse overflow-hidden rounded-lg text-left text-[11px] sm:text-[12px] lg:text-[13px]">
          <thead>
            <tr style={{ backgroundColor: mixThemeColorWithWhite(themeColorHex, 0.15), color: '#ffffff' }}>
              <th className={`${hideRowNumbersOnMobile ? 'hidden sm:table-cell' : 'table-cell'} w-10 px-2 py-2 text-center text-[11px] font-black uppercase tracking-wide text-white sm:px-3 sm:py-3 sm:text-[12px] lg:py-4 lg:text-[13px]`}>
                #
              </th>
              <th className="px-2 py-2 text-[11px] font-black uppercase tracking-wide text-white sm:px-3 sm:py-3 sm:text-[12px] lg:py-4 lg:text-[13px]">Item Description</th>
              <th className="whitespace-nowrap px-1 py-2 text-center text-[11px] font-black uppercase tracking-wide text-white sm:py-3 sm:text-[12px] lg:py-4 lg:text-[13px]">Rate</th>
              <th className="whitespace-nowrap px-1 py-2 text-center text-[11px] font-black uppercase tracking-wide text-white sm:py-3 sm:text-[12px] lg:py-4 lg:text-[13px]">Qty</th>
              <th className="whitespace-nowrap px-2 py-2 text-right text-[11px] font-black uppercase tracking-wide text-white sm:px-3 sm:py-3 lg:py-4 lg:text-[13px]">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {(renderItemRow ? items.map(renderItemRow) : items.map((item, index) => renderDefaultItemRow(item, index)))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderDefaultTotals = (
    <div className="flex flex-col items-end px-0">
      <div className="invoice-totals w-full max-w-[320px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm sm:w-full md:w-98 lg:max-w-xs print:max-w-[320px] print:w-[320px]">
        {totals.length ? (
          <>
            {totals.map((row, index) => {
              const isFirstRow = index === 0;
              const isFinalRow = index === totals.length - 1;
              const baseClass = 'flex items-center justify-between border-t border-gray-100 px-3 py-2.5';
              const toneClass = row.tone === 'success' ? 'text-emerald-600' : row.tone === 'theme' ? 'font-black' : row.tone === 'muted' ? 'text-gray-500' : 'text-gray-900';
              const isHighlighted = row.tone === 'theme' || isFinalRow;

              return (
                <div
                  key={`${row.label}-${index}`}
                  className={isFinalRow ? 'flex items-center justify-between px-3 py-2.5 text-white' : baseClass}
                  style={isFinalRow ? { backgroundColor: mixThemeColorWithWhite(themeColorHex, 0.15), color: '#ffffff' } : undefined}
                >
                  <span
                    className={[
                      'invoice-total-label uppercase tracking-wide',
                      isFinalRow ? 'invoice-total-final-label' : '',
                      isFinalRow ? 'text-white' : 'text-gray-500',
                      isFinalRow ? 'text-[11px] font-black sm:text-[12px] lg:text-sm' : 'text-[10px] font-bold sm:text-[11px] lg:text-xs',
                    ].join(' ')}
                  >
                    {row.label}
                  </span>
                  <span
                    className={[
                      'invoice-total-value',
                      isFinalRow ? 'invoice-total-final-value' : '',
                      isFinalRow ? 'text-white' : `${toneClass} ${isHighlighted ? 'text-gray-900' : ''}`,
                      isFinalRow ? 'text-[12px] font-black sm:text-[13px] lg:text-base' : 'text-[10px] font-black sm:text-[11px] lg:text-xs',
                    ].join(' ')}
                  >
                    {row.value}
                  </span>
                </div>
              );
            })}
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className={`invoice-layout-root overflow-hidden rounded-xl bg-white ${className}`} style={style}>
      <div className={contentClassName}>
        {hasTemplateSections ? (
          <>
            {brandBlock ?? (
              <div className="flex flex-row items-start justify-between gap-3 sm:gap-4 lg:gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 lg:gap-4">
                    {company?.logo && (
                      <img src={company.logo} className="rounded-lg object-contain" width={logoWidth} height={logoHeight} style={invoiceLogoStyle} alt="Company Logo" />
                    )}
                    <div className="min-w-0 flex flex-col justify-center">
                      <h1 className="invoice-brand-name break-words text-sm font-black tracking-tighter sm:text-base lg:text-xl" style={{ color: themeColorHex }}>
                        {company?.name || 'Company Name'}
                      </h1>
                      {company?.tagline && <p className="invoice-brand-tagline mt-0 text-[9px] font-semibold text-gray-400 sm:text-[10px] lg:text-xs">{company.tagline}</p>}
                    </div>
                  </div>
                  <div className="invoice-company-meta mt-3 flex flex-col gap-1 text-[9px] font-medium text-gray-500 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1 sm:text-[10px] lg:gap-x-5 lg:text-xs">
                    {company?.phone && <p className="flex items-center gap-2 break-words"><ReceiptText size={12} className="flex-shrink-0 text-gray-400" />{company.phone}</p>}
                    {company?.email && <p className="flex items-center gap-2 break-words"><CalendarDays size={12} className="flex-shrink-0 text-gray-400" />{company.email}</p>}
                    {company?.address && <p className="flex items-center gap-2 break-words"><MapPin size={12} className="flex-shrink-0 text-gray-400" />{company.address}</p>}
                  </div>
                </div>

                <div className="ml-auto inline-flex max-w-full flex-col items-start text-left sm:ml-0 sm:min-w-[210px] sm:flex-shrink-0">
                  <div className="flex w-fit max-w-full flex-col gap-2 text-left sm:flex-row sm:gap-2">
                    {invoiceNumber && (
                      <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-lg px-2 py-1.5 sm:px-2.5" style={{ backgroundColor: `${themeColorHex}14` }}>
                        <ReceiptText size={16} className="flex-shrink-0" style={{ color: themeColorHex }} />
                        <div>
                          <p className={`${defaultMetaLabelClass} invoice-meta-label`}>{invoiceNumberLabel}</p>
                          <p className={`${defaultMetaValueClass} invoice-meta-value`}>{invoiceNumber}</p>
                        </div>
                      </div>
                    )}
                    {invoiceDate && (
                      <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-lg px-2 py-1.5 sm:px-2.5" style={{ backgroundColor: `${themeColorHex}14` }}>
                        <CalendarDays size={16} className="flex-shrink-0" style={{ color: themeColorHex }} />
                        <div>
                          <p className={`${defaultMetaLabelClass} invoice-meta-label`}>{invoiceDateLabel}</p>
                          <p className={`${defaultMetaValueClass} invoice-meta-value`}>{invoiceDate}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {metadataBlock}

            {customerBlock ?? (
              customer ? renderDefaultCustomer : null
            )}

            {tableBlock ?? renderDefaultTable}

            {totalsBlock ?? renderDefaultTotals}

            {notesBlock ?? (notes ? (
              <div className="rounded-[10px] border border-gray-100 bg-gray-50 p-3 sm:p-4">
                <p className="invoice-notes-label mb-1 text-[8px] font-black uppercase tracking-widest text-gray-300 sm:mb-2 sm:text-[9px] lg:text-[10px]">Terms & Notes</p>
                <p className="invoice-notes-text text-[9px] font-medium italic leading-relaxed text-gray-600 sm:text-[10px] lg:text-xs">{notes}</p>
              </div>
            ) : null)}

            {footerBlock ?? (footer ? (
              <div className="rounded-[10px] border border-gray-100 bg-gray-50 p-3 sm:p-4">
                <p className="invoice-footer-text text-[9px] font-medium leading-relaxed text-gray-500 sm:text-[10px] lg:text-sm">{footer}</p>
              </div>
            ) : null)}
          </>
        ) : (
          children
        )}
      </div>

      <style>{`
        @media print {
          .invoice-layout-root {
            font-size: 16px;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
          }
          .invoice-brand-name {
            font-size: 1.45rem !important;
          }
          .invoice-brand-tagline {
            font-size: 0.82rem !important;
          }
          .invoice-company-meta {
            font-size: 0.85rem !important;
          }
          .invoice-page-title {
            font-size: 2rem !important;
          }
          .invoice-meta-label {
            font-size: 0.78rem !important;
          }
          .invoice-meta-value {
            font-size: 0.9rem !important;
          }
          .invoice-customer-title {
            font-size: 0.72rem !important;
          }
          .invoice-customer-name {
            font-size: 0.88rem !important;
          }
          .invoice-customer-sub {
            font-size: 0.72rem !important;
          }
          .invoice-address-label {
            font-size: 0.72rem !important;
          }
          .invoice-address-value {
            font-size: 0.88rem !important;
          }
          .invoice-address-content {
            gap: 0 !important;
          }
          .invoice-address-label,
          .invoice-address-value {
            display: block !important;
            margin-top: 0 !important;
            margin-bottom: 0 !important;
            line-height: 1.1 !important;
          }
          .invoice-item-table th {
            font-size: 0.8rem !important;
          }
          .invoice-item-table td {
            font-size: 0.8rem !important;
          }
          .invoice-item-rate,
          .invoice-item-total {
            font-size: 0.8rem !important;
          }
          .invoice-item-name {
            font-size: 0.9rem !important;
          }
          .invoice-item-badge {
            font-size: 0.65rem !important;
          }
          .invoice-item-image {
            width: 2.25rem !important;
            height: 2.25rem !important;
          }
          .invoice-total-label {
            font-size: 0.75rem !important;
          }
          .invoice-total-value {
            font-size: 0.88rem !important;
          }
          .invoice-total-final-label {
            font-size: 0.9rem !important;
          }
          .invoice-total-final-value {
            font-size: 1.08rem !important;
          }
          .invoice-notes-label {
            font-size: 0.74rem !important;
          }
          .invoice-notes-text,
          .invoice-footer-text {
            font-size: 0.88rem !important;
          }
        }
      `}</style>
    </div>
  );
};

export default InvoiceLayout;
