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
import { theme, resolveThemeColorPalette } from '../theme';
import { formatDate } from '../utils';

const PosOrderDetails: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useRolePermissions();
  const { hasCapability } = useCapabilities(Boolean(id));

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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <LoadingOverlay isLoading={loading && !order} message="Loading order details..." />

      {/* Header */}
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
        <div className="bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="p-4 sm:p-6 md:p-8 lg:p-10 space-y-4 sm:space-y-5">
            {/* Company + Invoice header */}
            <div className="flex flex-row justify-between items-start gap-3 sm:gap-4 lg:gap-6">
              <div className="flex-1 min-w-0">
                {(companySettings?.logo || db.settings.company.logo) && (
                  <img
                    src={companySettings?.logo || db.settings.company.logo}
                    className="details-invoice-logo rounded-lg object-contain mb-2 sm:mb-3 lg:mb-4"
                    width={invoiceLogoWidth}
                    height={invoiceLogoHeight}
                    style={invoiceLogoStyle}
                    alt="Company Logo"
                  />
                )}
                <h1 className="text-sm sm:text-base lg:text-xl font-black uppercase tracking-tighter break-words" style={{ color: themeColorHex }}>
                  {companySettings?.name || db.settings.company.name}
                </h1>
                <div className="mt-1 sm:mt-2 text-[9px] sm:text-[10px] lg:text-xs text-gray-400 font-medium space-y-0.5 sm:space-y-1">
                  <p className="break-words">{companySettings?.address || db.settings.company.address}</p>
                  <p className="text-[8px] sm:text-[9px] break-words">{companySettings?.phone || db.settings.company.phone} • {companySettings?.email || db.settings.company.email}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <h2 className="text-sm sm:text-2xl lg:text-3xl font-black text-gray-300 uppercase leading-none mb-1 sm:mb-2 break-words">
                  {invoiceSettings?.title || db.settings.invoice.title}
                </h2>
                <div className="space-y-0.5 sm:space-y-1 lg:space-y-1.5 text-[9px] sm:text-sm">
                  <p className="text-[9px] sm:text-xs lg:text-sm font-bold text-gray-900">
                    <span className="text-gray-400 font-medium">Order No:&nbsp;&nbsp;</span>
                    <span className="break-all">{order.orderNumber}</span>
                  </p>
                  <p className="text-[9px] sm:text-xs lg:text-sm font-bold text-gray-900">
                    <span className="text-gray-400 font-medium">Date:&nbsp;&nbsp;</span>
                    {formatDate(order.orderDate)}
                  </p>
                </div>
              </div>
            </div>

            {/* Billed To */}
            <div className="border-t border-gray-100 py-2 sm:py-3 lg:py-4">
              <p className="text-[8px] sm:text-[9px] lg:text-[10px] font-black text-gray-400 uppercase tracking-[0.15em] sm:tracking-[0.2em] mb-2 sm:mb-3 lg:mb-4">
                Billed To
              </p>
              <h3 className="text-sm sm:text-base lg:text-lg font-black text-gray-900 break-words">
                {customer?.name || order.customerName || 'Walk-in Customer'}
              </h3>
              {customer?.address && (
                <p className="text-[10px] sm:text-xs lg:text-sm text-gray-500 leading-relaxed break-words">{customer.address}</p>
              )}
              {customer?.phone && (
                <p className="text-[10px] sm:text-xs lg:text-sm font-bold text-gray-900 mt-1 sm:mt-1.5 lg:mt-2 break-words">{customer.phone}</p>
              )}
            </div>

            {/* Items table */}
            <div className="overflow-x-auto -mx-4 sm:-mx-6 lg:-mx-10">
              <div className="px-4 sm:px-6 lg:px-10">
                <table className="w-full text-left text-[10px] sm:text-xs lg:text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-100">
                      <th className="py-2 sm:py-3 lg:py-4 font-black text-gray-400 uppercase">Item Description</th>
                      <th className="py-2 sm:py-3 lg:py-4 text-center font-black text-gray-400 uppercase whitespace-nowrap px-1">Rate</th>
                      <th className="py-2 sm:py-3 lg:py-4 text-center font-black text-gray-400 uppercase whitespace-nowrap px-1">Qty</th>
                      <th className="py-2 sm:py-3 lg:py-4 text-right font-black text-gray-400 uppercase whitespace-nowrap px-1">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {order.items.map((item, idx) => {
                      const imageSrc =
                        typeof (item as any)?.productImage === 'string'
                          ? (item as any).productImage
                          : typeof (item as any)?.image === 'string'
                            ? (item as any).image
                            : productImages[String(item.productId || '').trim()] || '';
                      const amount = item.rate * item.quantity;
                      return (
                        <tr key={idx} className="group">
                          <td className="py-3 sm:py-4 lg:py-6">
                            <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 min-w-0">
                              {imageSrc ? (
                                <img src={imageSrc} className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 rounded-full object-cover border border-gray-100 shadow-sm flex-shrink-0" alt={item.productName} />
                              ) : (
                                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 rounded-full border border-gray-100 shadow-sm bg-gray-50 text-gray-400 text-xs flex items-center justify-center flex-shrink-0">
                                  {(item.productName || '?').slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <span className="font-bold text-[10px] sm:text-xs lg:text-base break-words text-gray-900">{item.productName}</span>
                            </div>
                          </td>
                          <td className="py-3 sm:py-4 lg:py-6 text-center text-gray-500 font-bold px-1 whitespace-nowrap">{formatCurrency(item.rate)}</td>
                          <td className="py-3 sm:py-4 lg:py-6 text-center font-bold text-gray-500 px-1 whitespace-nowrap">{item.quantity}</td>
                          <td className="py-3 sm:py-4 lg:py-6 text-right px-1 whitespace-nowrap">
                            <span className="font-black text-gray-900">{formatCurrency(amount)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals */}
            <div className="flex flex-col items-end pt-2 sm:pt-3 lg:pt-6 px-0">
              <div className="w-full sm:w-full md:w-98 lg:max-w-xs space-y-2 sm:space-y-3 lg:space-y-4">
                <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                  <span className="text-gray-400 font-bold uppercase flex-shrink-0">Subtotal</span>
                  <span className="font-bold text-gray-900 flex-shrink-0">{formatCurrency(order.subtotal)}</span>
                </div>
                {order.discount > 0 && (
                  <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                    <span className="text-gray-400 font-bold uppercase flex-shrink-0">Discount</span>
                    <span className="font-bold text-emerald-600 flex-shrink-0">-{formatCurrency(order.discount)}</span>
                  </div>
                )}
                {order.vatAmount > 0 && (
                  <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                    <span className="text-gray-400 font-bold uppercase flex-shrink-0">Tax ({order.vatRate}%)</span>
                    <span className="font-bold text-gray-900 flex-shrink-0">{formatCurrency(order.vatAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 sm:py-3 lg:py-4 border-t-2 border-[#0f2f57] gap-2">
                  <span className="font-black text-gray-900 uppercase tracking-tighter text-xs sm:text-base flex-shrink-0">Net Total</span>
                  <span className="font-black text-gray-900 text-xs sm:text-base flex-shrink-0">{formatCurrency(order.total)}</span>
                </div>

                {/* Payment summary */}
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                    <span className="text-gray-400 font-bold uppercase flex-shrink-0">Amount Paid</span>
                    <span className="font-bold text-emerald-600 flex-shrink-0">{formatCurrency(order.paidAmount)}</span>
                  </div>
                  {changeReturned > 0 && (
                    <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                      <span className="text-gray-400 font-bold uppercase flex-shrink-0">Change Returned</span>
                      <span className="font-bold text-emerald-600 flex-shrink-0">{formatCurrency(changeReturned)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Notes */}
            {order.notes && (
              <div className="bg-gray-50 p-3 sm:p-4 rounded-[10px] border border-gray-100">
                <p className="text-[8px] sm:text-[9px] lg:text-[10px] font-black text-gray-300 uppercase tracking-widest mb-1 sm:mb-2">Terms & Notes</p>
                <p className="text-[9px] sm:text-[10px] lg:text-xs text-gray-600 font-medium italic leading-relaxed">{order.notes}</p>
              </div>
            )}

            {/* Invoice footer */}
            {invoiceSettings?.footer && (
              <div className="bg-gray-50 p-3 sm:p-4 rounded-[10px] border border-gray-100">
                <p className="text-[9px] sm:text-[10px] lg:text-sm text-gray-500 font-medium leading-relaxed whitespace-pre-line">
                  {invoiceSettings.footer}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PosOrderDetails;
