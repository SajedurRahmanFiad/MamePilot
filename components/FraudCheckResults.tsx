import React from 'react';
import type { FraudCheckCourierHistory, FraudCheckReport, FraudCheckResult } from '../types';
import { formatDateTime } from '../utils';

type FraudCheckResultsProps = {
  result: FraudCheckResult;
};

const countFormatter = new Intl.NumberFormat('en-BD');
const ratioFormatter = new Intl.NumberFormat('en-BD', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const formatCount = (value: number): string => countFormatter.format(Math.max(0, value || 0));
const formatRatio = (value: number): string => `${ratioFormatter.format(Math.max(0, value || 0))}%`;

const ratioTone = (ratio: number): string => {
  if (ratio >= 80) return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (ratio >= 60) return 'border-amber-100 bg-amber-50 text-amber-700';
  return 'border-red-100 bg-red-50 text-red-700';
};

const metricCardClassName = 'rounded-2xl border border-gray-100 bg-white px-4 py-4 shadow-sm';

const CourierHistoryCard: React.FC<{ item: FraudCheckCourierHistory }> = ({ item }) => {
  const deliveredWidth = item.totalParcel > 0 ? Math.min(100, (item.successParcel / item.totalParcel) * 100) : 0;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
            {item.logo ? (
              <img src={item.logo} alt={item.name} className="h-full w-full object-contain" />
            ) : (
              <span className="text-xs font-black uppercase tracking-widest text-gray-300">{item.name.slice(0, 1)}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-base font-black text-gray-900">{item.name}</p>
            <p className="mt-1 text-xs font-medium text-gray-500">Courier history summary</p>
          </div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${ratioTone(item.successRatio)}`}>
          {formatRatio(item.successRatio)}
        </span>
      </div>

      <div className="mt-5 space-y-3">
        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-[#0f2f57] transition-all"
            style={{ width: `${Math.max(0, Math.min(100, deliveredWidth))}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Total</p>
            <p className="mt-2 text-lg font-black text-gray-900">{formatCount(item.totalParcel)}</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-500">Success</p>
            <p className="mt-2 text-lg font-black text-emerald-700">{formatCount(item.successParcel)}</p>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-500">Cancelled</p>
            <p className="mt-2 text-lg font-black text-rose-700">{formatCount(item.cancelledParcel)}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const ReportCard: React.FC<{ report: FraudCheckReport }> = ({ report }) => {
  const createdAtLabel = formatDateTime(report.createdAt) || 'Unknown report date';

  return (
    <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-amber-100 bg-white">
          {report.courierLogo ? (
            <img src={report.courierLogo} alt={report.courierName} className="h-full w-full object-contain" />
          ) : (
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-300">{report.courierName.slice(0, 1)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black text-gray-900">{report.name || 'Reported Name'}</p>
            {report.courierName && (
              <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">
                {report.courierName}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium leading-relaxed text-gray-600">{report.details || 'No report details available.'}</p>
          <p className="mt-3 text-xs font-semibold text-amber-700">{createdAtLabel}</p>
        </div>
      </div>
    </div>
  );
};

export const FraudCheckResults: React.FC<FraudCheckResultsProps> = ({ result }) => {
  const { summary, couriers, reports, phone } = result;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[#d6e3f0] bg-[#f8fbff] p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Courier History Summary</p>
            <h3 className="mt-2 text-2xl font-black text-gray-900">{formatRatio(summary.successRatio)}</h3>
            <p className="mt-2 text-sm font-medium text-gray-500">Overall success rate for phone number {phone}.</p>
          </div>
          <div className={`inline-flex rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${reports.length > 0 ? 'border-amber-200 bg-amber-100 text-amber-700' : 'border-emerald-200 bg-emerald-100 text-emerald-700'}`}>
            {reports.length > 0 ? `${formatCount(reports.length)} fraud report${reports.length > 1 ? 's' : ''}` : 'No fraud reports'}
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className={metricCardClassName}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Total Parcels</p>
            <p className="mt-2 text-2xl font-black text-gray-900">{formatCount(summary.totalParcel)}</p>
          </div>
          <div className={metricCardClassName}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Successful</p>
            <p className="mt-2 text-2xl font-black text-emerald-700">{formatCount(summary.successParcel)}</p>
          </div>
          <div className={metricCardClassName}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Cancelled</p>
            <p className="mt-2 text-2xl font-black text-rose-700">{formatCount(summary.cancelledParcel)}</p>
          </div>
          <div className={metricCardClassName}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Couriers Found</p>
            <p className="mt-2 text-2xl font-black text-gray-900">{formatCount(couriers.length)}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-lg font-black text-gray-900">Courier Breakdown</h4>
            <p className="mt-1 text-sm font-medium text-gray-500">Every courier history found for this phone number.</p>
          </div>
        </div>

        {couriers.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {couriers.map((item) => (
              <CourierHistoryCard key={item.key} item={item} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center text-sm font-medium text-gray-400">
            No courier history was returned for this phone number.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h4 className="text-lg font-black text-gray-900">Fraud Reports</h4>
          <p className="mt-1 text-sm font-medium text-gray-500">Merchant reports connected to this phone number.</p>
        </div>

        {reports.length > 0 ? (
          <div className="space-y-3">
            {reports.map((report) => (
              <ReportCard key={report.id || `${report.courierName}-${report.createdAt}`} report={report} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center text-sm font-medium text-gray-400">
            No fraud reports were returned for this phone number.
          </div>
        )}
      </section>
    </div>
  );
};

export default FraudCheckResults;
