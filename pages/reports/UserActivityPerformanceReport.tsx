import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components';
import { db } from '../../db';
import { formatCurrency, getStatusColor, ICONS } from '../../constants';
import { theme } from '../../theme';
import { useAuth } from '../../src/contexts/AuthProvider';
import { useToastNotifications } from '../../src/contexts/ToastContext';
import { useCapabilities } from '../../src/hooks/useCapabilities';
import { useCompanySettings, useUserActivityPerformanceLog, useUserActivityPerformanceReportPage } from '../../src/hooks/useQueries';
import { UserActivityPerformanceLogEntry, UserActivityPerformanceSummary, hasAdminAccess } from '../../types';
import { FilterRange, formatDate, formatDateTime as formatDisplayDateTime } from '../../utils';
import Pagination from '../../src/components/Pagination';

type RoleFilter = 'All Users' | 'Admins' | 'Employees';

const FILTERS: FilterRange[] = ['All Time', 'Today', 'This Week', 'This Month', 'This Year', 'Custom'];
const ROLE_FILTERS: RoleFilter[] = ['All Users', 'Admins', 'Employees'];

const formatDateTime = (value?: string | null): string => {
  return formatDisplayDateTime(value) || 'N/A';
};

const formatCount = (value: number): string => new Intl.NumberFormat('en-BD').format(value);

const statusBadge = (status: string) => {
  if (status === 'Income') return 'bg-emerald-100 text-emerald-700';
  if (status === 'Expense') return 'bg-rose-100 text-rose-700';
  if (status === 'Transfer') return 'bg-sky-100 text-sky-700';
  return getStatusColor(status);
};

const periodLabel = (filterRange: FilterRange, customDates: { from: string; to: string }) => {
  if (filterRange !== 'Custom') return filterRange;
  if (customDates.from && customDates.to) return `${formatDate(customDates.from)} to ${formatDate(customDates.to)}`;
  if (customDates.from) return `From ${formatDate(customDates.from)}`;
  if (customDates.to) return `Until ${formatDate(customDates.to)}`;
  return 'Custom Range';
};
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const sanitizeFileName = (value: string): string => value.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, ' ').trim();
const toAbsoluteAssetUrl = (value?: string | null): string => {
  if (!value) return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (typeof window === 'undefined') return value;

  try {
    return new URL(value, window.location.href).href;
  } catch {
    return value;
  }
};

const buildUserReportPdfHtml = (params: {
  report: UserActivityPerformanceSummary;
  companyName: string;
  companyLogo: string;
  generatedAt: string;
  selectedPeriod: string;
}) => {
  const { report, companyName, companyLogo, generatedAt, selectedPeriod } = params;
  const roleTone = hasAdminAccess(report.user.role) ? 'role-admin' : 'role-employee';
  const userImageSrc = toAbsoluteAssetUrl(report.user.image);
  const companyLogoSrc = toAbsoluteAssetUrl(companyLogo);
  const userAvatar = userImageSrc
    ? `<img src="${escapeHtml(userImageSrc)}" alt="${escapeHtml(report.user.name)}" class="avatar-image" />`
    : `<div class="avatar-fallback">${escapeHtml(report.user.name.slice(0, 1).toUpperCase())}</div>`;

  const summaryCards = [
    {
      label: 'Orders Created',
      value: formatCount(report.metrics.ordersCreated),
      hint: `${formatCount(report.metrics.completedOrders)} completed | ${formatCount(report.metrics.cancelledOrders)} cancelled`,
      tone: 'card-blue',
    },
    {
      label: 'Order Value',
      value: formatCurrency(report.metrics.orderValue),
      hint: `${formatCurrency(report.metrics.orderPaidAmount)} collected`,
      tone: 'card-green',
    },
    {
      label: 'Bills Created',
      value: formatCount(report.metrics.billsCreated),
      hint: `${formatCurrency(report.metrics.billValue)} purchase value`,
      tone: 'card-amber',
    },
    {
      label: 'Transactions Posted',
      value: formatCount(report.metrics.transactionsCreated),
      hint: `${formatCount(report.metrics.activeDays)} active days`,
      tone: 'card-rose',
    },
  ];

  const salaryRowsLeft: Array<[string, string | number]> = [
    ['Active days', formatCount(report.metrics.activeDays)],
    ['Unique customers served', formatCount(report.metrics.uniqueCustomers)],
    ['Items handled in orders', formatCount(report.metrics.orderQuantity)],
    ['Average order value', formatCurrency(report.metrics.averageOrderValue)],
    ['Completion rate', `${Math.round(report.metrics.completionRate)}%`],
    ['Collection rate', `${Math.round(report.metrics.collectionRate)}%`],
  ];

  const salaryRowsRight: Array<[string, string | number]> = [
    ['Completed order value', formatCurrency(report.metrics.completedOrderValue)],
    ['Purchase settlement rate', `${Math.round(report.metrics.billSettlementRate)}%`],
    ['Income entries', `${formatCount(report.metrics.incomeTransactions)} | ${formatCurrency(report.metrics.incomeAmount)}`],
    ['Expense entries', `${formatCount(report.metrics.expenseTransactions)} | ${formatCurrency(report.metrics.expenseAmount)}`],
    ['Transfer entries', `${formatCount(report.metrics.transferTransactions)} | ${formatCurrency(report.metrics.transferAmount)}`],
    ['Last activity', report.metrics.lastActivity ? formatDateTime(report.metrics.lastActivity) : 'No activity'],
  ];

  const statusRows: [string, number][] = [
    ['On Hold', report.metrics.onHoldOrders],
    ['Processing', report.metrics.processingOrders],
    ['Picked', report.metrics.pickedOrders],
    ['Completed', report.metrics.completedOrders],
    ['Cancelled', report.metrics.cancelledOrders],
  ];

  const extraRows: Array<[string, string | number]> = [
    ['Unique vendors handled', formatCount(report.metrics.uniqueVendors)],
    ['Bills paid amount', formatCurrency(report.metrics.billPaidAmount)],
    ['First tracked activity', report.metrics.firstActivity ? formatDateTime(report.metrics.firstActivity) : 'No activity'],
    ['Tracked activities', formatCount(report.metrics.totalActivities)],
  ];

  const renderStatRows = (rows: Array<[string, string | number]>) =>
    rows
      .map(
        ([label, value]) => `
          <tr>
            <td>${escapeHtml(label)}</td>
            <td>${escapeHtml(String(value))}</td>
          </tr>
        `
      )
      .join('');

  const renderStatusRows = statusRows
    .map(([label, value]) => {
      const count = Number(value);
      const share = report.metrics.ordersCreated > 0 ? `${Math.round((count / report.metrics.ordersCreated) * 100)}%` : '0%';
      return `
        <tr>
          <td>${escapeHtml(label)}</td>
          <td>${escapeHtml(formatCount(count))}</td>
          <td>${escapeHtml(share)}</td>
        </tr>
      `;
    })
    .join('');

  const renderSummaryCards = summaryCards
    .map(
      (card) => `
        <div class="summary-card ${card.tone}">
          <p class="summary-label">${escapeHtml(card.label)}</p>
          <h3 class="summary-value">${escapeHtml(card.value)}</h3>
          <p class="summary-hint">${escapeHtml(card.hint)}</p>
        </div>
      `
    )
    .join('');

  const logoMarkup = companyLogoSrc
    ? `<img src="${escapeHtml(companyLogoSrc)}" alt="${escapeHtml(companyName)}" class="company-logo" />`
    : `<div class="company-logo company-logo-fallback">${escapeHtml(companyName.slice(0, 1).toUpperCase())}</div>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(sanitizeFileName(`${report.user.name} Activity Performance Report`))}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      * {
        box-sizing: border-box;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body {
        margin: 0;
        background: #f2efe8;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
        line-height: 1.55;
      }
      .page {
        width: 100%;
        margin: 0 auto;
        background: #ffffff;
      }
      .header {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .user-card {
        display: flex;
        gap: 14px;
        align-items: center;
        padding: 18px;
        border-radius: 14px;
        background-color: #f8fafc;
        border: 1px solid #d6dde5;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
      }
      .avatar-image,
      .avatar-fallback {
        width: 72px;
        height: 72px;
        border-radius: 16px;
        flex: 0 0 72px;
      }
      .avatar-image {
        object-fit: cover;
        border: 1px solid #d8e0e8;
      }
      .avatar-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        background: #243a57;
        color: #ffffff;
        font-size: 28px;
        font-weight: 700;
      }
      .user-meta h1 {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 26px;
        font-weight: 700;
        line-height: 1.2;
      }
      .meta-line {
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 12.5px;
        color: #526173;
      }
      .role-badge {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .role-admin {
        background: #efe8f8;
        color: #6a4f8d;
      }
      .role-employee {
        background: #e7eef8;
        color: #365f8d;
      }
      .report-meta {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 18px;
        padding: 24px;
        border-radius: 16px;
        background-color: #f7f9fa;
      }
      .report-meta-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
      }
      .report-meta-copy {
        max-width: 72%;
      }
      .report-kicker {
        margin: 0;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .report-title {
        margin: 8px 0 6px;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 26px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      .report-subtitle {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.5;
      }
      .company-lockup {
        display: flex;
        align-items: flex-start;
        gap: 14px;
      }
      .company-logo {
        width: 46px;
        height: 46px;
        border-radius: 12px;
        object-fit: cover;
        background-color: rgba(255, 255, 255, 0.14);
      }
      .company-logo-fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-weight: 700;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        font-size: 12.5px;
      }
      .meta-item {
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background-color: rgba(255, 255, 255, 0.08);
      }
      .meta-item span {
        display: block;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .section {
        margin-top: 16px;
      }
      .section-panel {
        border: 1px solid #d9e0e7;
        border-radius: 16px;
        background-color: #ffffff;
        padding: 20px;
      }
      .section-title {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 19px;
        font-weight: 700;
      }
      .section-subtitle {
        margin: 5px 0 0;
        font-size: 12.5px;
        color: #677487;
        line-height: 1.5;
      }
      .summary-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin-top: 16px;
      }
      .summary-card {
        border-radius: 14px;
        padding: 16px;
        border: 1px solid;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
      }
      .summary-label {
        margin: 0;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #5c6978;
      }
      .summary-value {
        margin: 8px 0 5px;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 25px;
        font-weight: 700;
        line-height: 1.2;
      }
      .summary-hint {
        margin: 0;
        font-size: 12px;
        color: #5d6875;
        line-height: 1.45;
      }
      .card-blue {
        background-color: #f5f9ff;
        border-color: #d8e4f2;
        color: #20344f;
      }
      .card-green {
        background-color: #f7fbf7;
        border-color: #d6e7d8;
        color: #315544;
      }
      .card-amber {
        background-color: #fffaf3;
        border-color: #eadcc2;
        color: #735833;
      }
      .card-rose {
        background-color: #fff7f8;
        border-color: #ecd8dd;
        color: #7f4955;
      }
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin-top: 16px;
      }
      .sub-panel {
        border: 1px solid #dde4ea;
        border-radius: 14px;
        padding: 18px;
        background-color: #fcfdff;
      }
      .sub-title {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 16.5px;
        font-weight: 700;
      }
      .sub-copy {
        margin: 6px 0 0;
        font-size: 12.5px;
        color: #677487;
        line-height: 1.5;
      }
      table.info-table,
      table.status-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 16px;
      }
      table.info-table td,
      table.status-table td,
      table.status-table th {
        padding: 10px 0;
        border-bottom: 1px solid #e3e8ee;
        vertical-align: top;
      }
      table.info-table tr:last-child td,
      table.status-table tr:last-child td {
        border-bottom: none;
      }
      table.info-table td:first-child {
        font-size: 12.5px;
        color: #5d6b7a;
        padding-right: 12px;
      }
      table.info-table td:last-child {
        text-align: right;
        font-size: 12.5px;
        font-weight: 600;
        color: #203040;
      }
      table.status-table th {
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #7a8695;
        text-align: left;
      }
      table.status-table th:nth-child(2),
      table.status-table th:nth-child(3),
      table.status-table td:nth-child(2),
      table.status-table td:nth-child(3) {
        text-align: right;
      }
      table.status-table td {
        font-size: 12.5px;
        color: #2a3747;
      }
      .note {
        margin-top: 16px;
        padding: 13px 15px;
        border-radius: 14px;
        border: 1px solid #d9e0e7;
        background-color: #fafcfe;
        font-size: 12.5px;
        color: #5a6776;
        line-height: 1.6;
      }
      .footer {
        margin-top: 18px;
        font-size: 11px;
        color: #808b98;
        text-align: center;
      }
      @media (max-width: 900px) {
        .report-meta-top,
        .company-lockup {
          flex-direction: column;
        }
        .report-meta-copy {
          max-width: 100%;
        }
        .meta-grid,
        .detail-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media print {
        body { background: #ffffff; }
        .page { margin: 0; }
        .report-meta,
        .user-card,
        .summary-card,
        .sub-panel,
        .note,
        .meta-item {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <section class="header">
        <div class="report-meta">
          <div class="report-meta-top">
            <div class="company-lockup">
              ${logoMarkup}
              <div class="report-meta-copy">
                <h2 class="report-title">${escapeHtml(companyName)}</h2>
                <p class="report-subtitle">User activity, performance review, and compensation support summary</p>
              </div>
            </div>
          </div>
          <div class="meta-grid">
            <div class="meta-item"><span>Period</span>${escapeHtml(selectedPeriod)}</div>
            <div class="meta-item"><span>Generated</span>${escapeHtml(generatedAt)}</div>
          </div>
        </div>
        <div class="user-card">
          ${userAvatar}
          <div class="user-meta">
            <p class="report-kicker" style="color:#6f7d8d;">User Activity & Performance</p>
            <h1>${escapeHtml(report.user.name)}</h1>
            <div class="meta-line">
              <span>${escapeHtml(report.user.phone || 'No phone')}</span>
              <span class="role-badge ${roleTone}">${escapeHtml(report.user.role)}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="section section-panel">
        <h3 class="section-title">Performance Snapshot</h3>
        <p class="section-subtitle">All headline figures currently shown on the user activity and performance page, prepared for formal review.</p>
        <div class="summary-grid">
          ${renderSummaryCards}
        </div>
      </section>

      <section class="section detail-grid">
        <div class="sub-panel">
          <h4 class="sub-title">Salary Analysis Inputs</h4>
          <p class="sub-copy">Tracked inputs that support salary, commission, and performance-based compensation decisions.</p>
          <table class="info-table">
            ${renderStatRows(salaryRowsLeft)}
          </table>
          <table class="info-table">
            ${renderStatRows(salaryRowsRight)}
          </table>
        </div>

        <div class="sub-panel">
          <h4 class="sub-title">Order Status Breakdown</h4>
          <p class="sub-copy">Status distribution for all orders created by this user in the selected period.</p>
          <table class="status-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Orders</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              ${renderStatusRows}
            </tbody>
          </table>
          <table class="info-table">
            ${renderStatRows(extraRows)}
          </table>
        </div>
      </section>

      <div class="note">
        Detailed activity log entries remain available on-screen for analysis and are intentionally excluded from this PDF export.
      </div>

      <div class="footer">
        Generated by ${escapeHtml(companyName)} | User Activity & Performance
      </div>
    </div>
    <script>
      const ready = () => {
        const images = Array.from(document.images || []);
        Promise.all(
          images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
            image.onload = resolve;
            image.onerror = resolve;
          }))
        ).then(() => {
          window.focus();
          setTimeout(() => window.print(), 250);
        });
      };
      window.addEventListener('load', ready);
      window.addEventListener('afterprint', () => window.close());
    </script>
  </body>
</html>`;
};

const MetricCard: React.FC<{ label: string; value: string; hint: string; tone: string }> = ({ label, value, hint, tone }) => (
  <div className={`rounded-2xl border p-4 ${tone}`}>
    <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70">{label}</p>
    <h4 className="mt-3 text-lg font-black">{value}</h4>
    <p className="mt-2 text-xs font-semibold opacity-80">{hint}</p>
  </div>
);

const StatRow: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0">
    <span className="text-sm font-medium text-gray-500">{label}</span>
    <span className={`text-sm font-black ${accent ? 'text-[#0f2f57]' : 'text-gray-900'}`}>{value}</span>
  </div>
);

const SkeletonBlock: React.FC<{ className: string }> = ({ className }) => (
  <div className={`animate-pulse rounded-2xl bg-gray-200/80 ${className}`} />
);

const ActivityLogSkeleton: React.FC = () => (
  <div className="space-y-3 px-6 py-6">
    {Array.from({ length: 5 }).map((_, index) => (
      <div key={index} className="grid grid-cols-[1.1fr_0.8fr_1fr_1.3fr] gap-3">
        <SkeletonBlock className="h-12" />
        <SkeletonBlock className="h-12" />
        <SkeletonBlock className="h-12" />
        <SkeletonBlock className="h-12" />
      </div>
    ))}
  </div>
);

const UserActivityReportSkeleton: React.FC = () => (
  <div className="space-y-6">
    <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
      <div className="bg-gradient-to-r from-[#0f2f57] via-[#153867] to-[#1f4b85] px-6 py-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-4">
            <SkeletonBlock className="h-14 w-14 bg-white/20" />
            <div className="space-y-3">
              <SkeletonBlock className="h-3 w-28 bg-white/20" />
              <SkeletonBlock className="h-8 w-56 bg-white/20" />
              <SkeletonBlock className="h-4 w-64 bg-white/20" />
            </div>
          </div>
          <div className="space-y-2 rounded-2xl border border-white/15 bg-white/10 px-5 py-4">
            <SkeletonBlock className="h-4 w-48 bg-white/20" />
            <SkeletonBlock className="h-4 w-40 bg-white/20" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 px-6 py-6 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-gray-100 p-4">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="mt-4 h-7 w-28" />
            <SkeletonBlock className="mt-3 h-4 w-36" />
          </div>
        ))}
      </div>
    </div>

    {Array.from({ length: 3 }).map((_, index) => (
      <section key={index} className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gradient-to-r from-white via-[#f8fbff] to-white px-6 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <SkeletonBlock className="h-16 w-16 rounded-2xl" />
              <div className="space-y-3">
                <SkeletonBlock className="h-6 w-40" />
                <SkeletonBlock className="h-4 w-32" />
              </div>
            </div>
            <SkeletonBlock className="h-10 w-32" />
          </div>
        </div>
        <div className="space-y-6 px-6 py-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((__, cardIndex) => (
              <div key={cardIndex} className="rounded-2xl border border-gray-100 p-4">
                <SkeletonBlock className="h-3 w-24" />
                <SkeletonBlock className="mt-4 h-7 w-28" />
                <SkeletonBlock className="mt-3 h-4 w-32" />
              </div>
            ))}
          </div>
          <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-3xl border border-gray-100 p-6">
              {Array.from({ length: 6 }).map((__, rowIndex) => (
                <div key={rowIndex} className="flex items-center justify-between border-b border-gray-100 py-3 last:border-b-0">
                  <SkeletonBlock className="h-4 w-32" />
                  <SkeletonBlock className="h-4 w-24" />
                </div>
              ))}
            </div>
            <div className="rounded-3xl border border-gray-100 p-6">
              {Array.from({ length: 5 }).map((__, rowIndex) => (
                <div key={rowIndex} className="space-y-2 py-2">
                  <div className="flex items-center justify-between">
                    <SkeletonBlock className="h-4 w-24" />
                    <SkeletonBlock className="h-4 w-10" />
                  </div>
                  <SkeletonBlock className="h-3 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    ))}
  </div>
);

const UserActivityLogPanel: React.FC<{
  userId: string;
  isExpanded: boolean;
  filterRange: FilterRange;
  customDates: { from: string; to: string };
}> = ({ userId, isExpanded, filterRange, customDates }) => {
  const { data: entries = [], isPending, error } = useUserActivityPerformanceLog(
    userId,
    { filterRange, customDates },
    { enabled: isExpanded }
  );

  if (!isExpanded) {
    return (
      <div className="px-6 py-6 text-sm font-medium text-gray-400">
        Expand this section to review the full activity-by-activity log for this user.
      </div>
    );
  }

  if (isPending) {
    return <ActivityLogSkeleton />;
  }

  if (error) {
    return (
      <div className="px-6 py-6 text-sm font-medium text-rose-500">
        Failed to load the activity log for this user.
      </div>
    );
  }

  return (
    <div className="print-overflow-reset overflow-x-auto">
      <table className="activity-table min-w-full text-left">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Date</th>
            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Type</th>
            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Reference</th>
            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Counterparty</th>
            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Details</th>
            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 text-right">Qty</th>
            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 text-right">Amount</th>
            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {entries.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-6 py-16 text-center text-sm font-medium italic text-gray-400">
                No activity tracked for this user in the selected period.
              </td>
            </tr>
          ) : (
            entries.map((entry: UserActivityPerformanceLogEntry) => (
              <tr key={entry.id} className="hover:bg-gray-50/70">
                <td className="px-6 py-4 text-sm font-semibold text-gray-600">{formatDateTime(entry.rawDate)}</td>
                <td className="px-6 py-4">
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-gray-600">{entry.type}</span>
                </td>
                <td className="px-6 py-4 text-sm font-black text-gray-900">{entry.reference}</td>
                <td className="px-6 py-4 text-sm font-semibold text-gray-700">{entry.counterparty}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{entry.details}</td>
                <td className="px-6 py-4 text-right text-sm font-black text-gray-900">{entry.quantity === null ? '-' : formatCount(entry.quantity)}</td>
                <td className="px-6 py-4 text-right text-sm font-black text-gray-900">{entry.amount === null ? '-' : formatCurrency(entry.amount)}</td>
                <td className="px-6 py-4 text-right">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${statusBadge(entry.status)}`}>{entry.status}</span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

const UserActivityPerformanceReport: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToastNotifications();
  const { hasCapability } = useCapabilities();
  const { data: companySettings } = useCompanySettings();
  const hasSales = hasCapability('sales');
  const hasPurchases = hasCapability('purchases');
  const hasBanking = hasCapability('banking');

  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('All Users');
  const [onlyActive, setOnlyActive] = useState(false);
  const [expandedLogUserIds, setExpandedLogUserIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const usersPerPage = 10;

  const generatedAt = useMemo(() => formatDisplayDateTime(new Date()), []);
  const companyName = companySettings?.name || db.settings.company.name || 'Mame Pilot';
  const companyLogo = companySettings?.logo || db.settings.company.logo || '';
  const selectedPeriod = useMemo(() => periodLabel(filterRange, customDates), [filterRange, customDates]);
  const reportFilters = useMemo(
    () => ({
      search: searchQuery,
      roleFilter,
      filterRange,
      customDates,
      onlyActive,
    }),
    [searchQuery, roleFilter, filterRange, customDates, onlyActive]
  );
  const canLoadReport = !!user && hasAdminAccess(user.role);
  const { data: reportPage, isPending: reportLoading, isFetching: reportFetching } = useUserActivityPerformanceReportPage(
    currentPage,
    usersPerPage,
    reportFilters,
    { enabled: canLoadReport }
  );
  const reports = reportPage?.data ?? [];
  const totals = reportPage?.totals ?? { users: 0, activeUsers: 0, orders: 0, bills: 0, transactions: 0, orderValue: 0 };
  const totalUsers = reportPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalUsers / usersPerPage));

  React.useEffect(() => {
    setCurrentPage(1);
    setExpandedLogUserIds([]);
  }, [searchQuery, roleFilter, filterRange, customDates.from, customDates.to, onlyActive]);

  React.useEffect(() => {
    setExpandedLogUserIds([]);
  }, [currentPage]);

  const toggleActivityLog = (userId: string) => {
    setExpandedLogUserIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  };

  const handleExportUserPdf = (report: UserActivityPerformanceSummary) => {
    const printWindow = window.open('', '_blank', 'width=1100,height=820');

    if (!printWindow) {
      toast.error('Please allow pop-ups to export the user PDF.');
      return;
    }

    try {
      const reportHtml = buildUserReportPdfHtml({
        report,
        companyName,
        companyLogo,
        generatedAt,
        selectedPeriod,
      });

      printWindow.document.open();
      printWindow.document.write(reportHtml);
      printWindow.document.close();
      printWindow.focus();
    } catch (error) {
      printWindow.close();
      toast.error(error instanceof Error ? error.message : 'Could not prepare the report. Please try again.');
    }
  };

  if (!user) return <div className="p-8 text-center text-gray-500">Loading report access...</div>;
  if (!hasAdminAccess(user.role)) return <div className="p-8 text-center text-gray-500">This report is available to admin-access users only.</div>;
  if (reportLoading && !reportPage) {
    return <UserActivityReportSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/reports')} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </button>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">User Activity & Performance</h2>
          </div>
        </div>
        
      </div>

      <div className="report-cover overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-[#0f2f57] via-[#153867] to-[#1f4b85] px-6 py-6 text-white">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-4">
              {companyLogo ? <img src={companyLogo} alt={companyName} className="h-14 w-14 rounded-2xl object-cover bg-white/10 p-1" /> : <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-2xl font-black">{companyName.slice(0, 1).toUpperCase()}</div>}
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#c7dff5]">Admin Report</p>
                <h3 className="mt-2 text-2xl font-black">{companyName}</h3>
                <p className="mt-1 text-sm text-[#d7e8fb]">Built from tracked orders, bills, and transactions by user.</p>
              </div>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 text-sm font-medium">
              <p><span className="text-[#c7dff5]">Period:</span> {selectedPeriod}</p>
              <p className="mt-1"><span className="text-[#c7dff5]">Generated:</span> {generatedAt}</p>
            </div>
          </div>
        </div>

        <div className="no-print border-b border-gray-100 px-6 py-6">
          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <div className="space-y-4">
              <div className="relative">
                <input type="text" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search by name, phone, or role" className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 pl-11 text-sm font-medium outline-none focus:ring-2 focus:ring-[#3c5a82]" />
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">{ICONS.Search}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 p-2">
                {FILTERS.map((range) => (
                  <button key={range} onClick={() => setFilterRange(range)} className={`rounded-xl px-4 py-2 text-xs font-black transition-all ${filterRange === range ? `${theme.colors.primary[600]} text-white` : 'text-gray-500 hover:bg-white'}`}>{range}</button>
                ))}
                {filterRange === 'Custom' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
                    <input type="date" value={customDates.from} onChange={(event) => setCustomDates((current) => ({ ...current, from: event.target.value }))} className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-300">To</span>
                    <input type="date" value={customDates.to} onChange={(event) => setCustomDates((current) => ({ ...current, to: event.target.value }))} className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]" />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {ROLE_FILTERS.map((filter) => (
                  <button key={filter} onClick={() => setRoleFilter(filter)} className={`rounded-xl border px-4 py-2 text-xs font-black transition-all ${roleFilter === filter ? 'border-[#0f2f57] bg-[#0f2f57] text-white' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}>{filter}</button>
                ))}
              </div>
              <label className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
                <input type="checkbox" checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-[#0f2f57] focus:ring-[#3c5a82]" />
                <div>
                  <p className="text-sm font-black text-gray-900">Only show users with activity</p>
                  <p className="text-xs font-medium text-gray-500">Hide empty users for the selected period.</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className={`grid grid-cols-1 gap-4 px-6 py-6 md:grid-cols-2 ${hasSales && hasBanking ? 'xl:grid-cols-5' : hasSales || hasBanking ? 'xl:grid-cols-4' : 'xl:grid-cols-2'}`}>
          <MetricCard label="Users Included" value={formatCount(totals.users)} hint={`${formatCount(totals.activeUsers)} active users`} tone="bg-[#ebf4ff] border-[#c7dff5] text-[#0f2f57]" />
          {hasSales && <MetricCard label="Orders Captured" value={formatCount(totals.orders)} hint="User-created orders in this view" tone="bg-emerald-50 border-emerald-100 text-emerald-700" />}
          {hasPurchases && <MetricCard label="Bills Captured" value={formatCount(totals.bills)} hint="User-created bills in this view" tone="bg-amber-50 border-amber-100 text-amber-700" />}
          {hasBanking && <MetricCard label="Finance Entries" value={formatCount(totals.transactions)} hint="Transactions posted by users" tone="bg-rose-50 border-rose-100 text-rose-700" />}
          {hasSales && <MetricCard label="Gross Order Value" value={formatCurrency(totals.orderValue)} hint="All tracked order totals" tone="bg-[#ebf4ff] border-[#c7dff5] text-[#0f2f57]" />}
        </div>
      </div>

      {reports.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-gray-200 bg-white p-16 text-center text-gray-500">No users matched the current filters.</div>
      ) : (
        <>
          <div className="space-y-6">
            {reports.map((report) => {
              const isLogExpanded = expandedLogUserIds.includes(report.user.id);
              const statusRows = [
                { label: 'On Hold', value: report.metrics.onHoldOrders, color: 'bg-amber-500', track: 'bg-amber-100' },
                { label: 'Processing', value: report.metrics.processingOrders, color: 'bg-sky-500', track: 'bg-sky-100' },
                { label: 'Picked', value: report.metrics.pickedOrders, color: 'bg-cyan-500', track: 'bg-cyan-100' },
                { label: 'Completed', value: report.metrics.completedOrders, color: 'bg-emerald-500', track: 'bg-emerald-100' },
                { label: 'Cancelled', value: report.metrics.cancelledOrders, color: 'bg-rose-500', track: 'bg-rose-100' },
              ];
              const maxStatus = Math.max(1, ...statusRows.map((row) => row.value));

              return (
                <section key={report.user.id} className="user-report-card overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm" data-user-id={report.user.id}>
                  <div className="border-b border-gray-100 bg-gradient-to-r from-white via-[#f8fbff] to-white px-6 py-6">
                    <div className="rounded-3xl">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="rounded-2xl border border-gray-100 bg-white px-5 py-4 shadow-sm">
                          <div className="flex items-center gap-4">
                            {report.user.image ? <img src={report.user.image} alt={report.user.name} className="h-16 w-16 rounded-2xl object-cover ring-1 ring-[#dce6f2]" /> : <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0f2f57] text-2xl font-black text-white">{report.user.name.slice(0, 1).toUpperCase()}</div>}
                            <div className="min-w-0">
                              <h3 className="mt-2 truncate text-xl font-black text-gray-900">{report.user.name}</h3>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-medium text-gray-500">
                                <span>{report.user.phone || 'No phone'}</span>
                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${hasAdminAccess(report.user.role) ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{report.user.role}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="no-print md:ml-auto">
                          <Button onClick={() => handleExportUserPdf(report)} variant="primary" size="md" icon={ICONS.Download}>Export PDF</Button>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 text-sm font-medium text-gray-600 sm:grid-cols-2">
                        <div className="rounded-2xl bg-white px-4 py-3 border border-[#d6e3f0]">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Period</p>
                          <p className="mt-1 text-sm font-bold text-gray-900">{selectedPeriod}</p>
                        </div>
                        <div className="rounded-2xl bg-white px-4 py-3 border border-[#d6e3f0]">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Generated</p>
                          <p className="mt-1 text-sm font-bold text-gray-900">{generatedAt}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-8 px-6 py-6">
                    <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${hasSales && hasPurchases && hasBanking ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
                      {hasSales && <MetricCard label="Orders Created" value={formatCount(report.metrics.ordersCreated)} hint={`${formatCount(report.metrics.completedOrders)} completed | ${formatCount(report.metrics.cancelledOrders)} cancelled`} tone="bg-[#ebf4ff] border-[#c7dff5] text-[#0f2f57]" />}
                      {hasSales && <MetricCard label="Order Value" value={formatCurrency(report.metrics.orderValue)} hint={`${formatCurrency(report.metrics.orderPaidAmount)} collected`} tone="bg-emerald-50 border-emerald-100 text-emerald-700" />}
                      {hasPurchases && <MetricCard label="Bills Created" value={formatCount(report.metrics.billsCreated)} hint={`${formatCurrency(report.metrics.billValue)} purchase value`} tone="bg-amber-50 border-amber-100 text-amber-700" />}
                      {hasBanking && <MetricCard label="Transactions Posted" value={formatCount(report.metrics.transactionsCreated)} hint={`${formatCount(report.metrics.activeDays)} active days`} tone="bg-rose-50 border-rose-100 text-rose-700" />}
                    </div>

                    <div className={`grid gap-6 ${hasSales ? 'xl:grid-cols-[1.15fr_0.85fr]' : ''}`}>
                      <div className="rounded-3xl border border-gray-100 bg-white p-6">
                        <h4 className="text-lg font-black text-gray-900">Salary Analysis Inputs</h4>
                        <p className="text-sm text-gray-500">Tracked inputs admins can use for salary and incentive decisions.</p>
                        <div className="mt-4 grid gap-1 md:grid-cols-2 md:gap-x-8">
                          <div>
                            <StatRow label="Active days" value={formatCount(report.metrics.activeDays)} accent />
                            {hasSales && <StatRow label="Unique customers served" value={formatCount(report.metrics.uniqueCustomers)} />}
                            {hasSales && <StatRow label="Items handled in orders" value={formatCount(report.metrics.orderQuantity)} />}
                            {hasSales && <StatRow label="Average order value" value={formatCurrency(report.metrics.averageOrderValue)} />}
                            {hasSales && <StatRow label="Completion rate" value={`${Math.round(report.metrics.completionRate)}%`} />}
                            {hasSales && <StatRow label="Collection rate" value={`${Math.round(report.metrics.collectionRate)}%`} />}
                          </div>
                          <div>
                            {hasSales && <StatRow label="Completed order value" value={formatCurrency(report.metrics.completedOrderValue)} accent />}
                            {hasPurchases && <StatRow label="Purchase settlement rate" value={`${Math.round(report.metrics.billSettlementRate)}%`} />}
                            {hasBanking && <StatRow label="Income entries" value={`${formatCount(report.metrics.incomeTransactions)} | ${formatCurrency(report.metrics.incomeAmount)}`} />}
                            {hasBanking && <StatRow label="Expense entries" value={`${formatCount(report.metrics.expenseTransactions)} | ${formatCurrency(report.metrics.expenseAmount)}`} />}
                            {hasBanking && <StatRow label="Transfer entries" value={`${formatCount(report.metrics.transferTransactions)} | ${formatCurrency(report.metrics.transferAmount)}`} />}
                            <StatRow label="Last activity" value={report.metrics.lastActivity ? formatDateTime(report.metrics.lastActivity) : 'No activity'} />
                          </div>
                        </div>
                      </div>

                      {hasSales && (
                      <div className="rounded-3xl border border-gray-100 bg-white p-6">
                        <h4 className="text-lg font-black text-gray-900">Order Status Breakdown</h4>
                        <p className="mt-1 text-sm text-gray-500">Snapshot of all orders created by this user.</p>
                        <div className="mt-6 space-y-4">
                          {statusRows.map((row) => (
                            <div key={row.label}>
                              <div className="mb-2 flex items-center justify-between text-sm">
                                <span className="font-semibold text-gray-600">{row.label}</span>
                                <span className="font-black text-gray-900">{formatCount(row.value)}</span>
                              </div>
                              <div className={`h-3 overflow-hidden rounded-full ${row.track}`}>
                                <div className={`h-full rounded-full ${row.color}`} style={{ width: row.value === 0 ? '0%' : `${Math.max((row.value / maxStatus) * 100, 8)}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                        {hasPurchases && (
                        <div className="mt-6 border-t border-gray-100 pt-5">
                          <StatRow label="Unique vendors handled" value={formatCount(report.metrics.uniqueVendors)} />
                          <StatRow label="Bills paid amount" value={formatCurrency(report.metrics.billPaidAmount)} />
                          <StatRow label="First tracked activity" value={report.metrics.firstActivity ? formatDateTime(report.metrics.firstActivity) : 'No activity'} />
                        </div>
                        )}
                      </div>
                      )}
                    </div>

                    <div className="exclude-from-user-pdf overflow-hidden rounded-3xl border border-gray-100 bg-white">
                      <div className="flex flex-col gap-3 border-b border-gray-100 px-6 py-5 md:flex-row md:items-center md:justify-between">
                        <div>
                          <h4 className="text-lg font-black text-gray-900">Detailed Activity Log</h4>
                          <p className="text-sm text-gray-500">Every filtered order, bill, and transaction linked to this user.</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="rounded-2xl bg-gray-50 px-3 py-2 text-sm font-bold text-gray-600">{formatCount(report.metrics.totalActivities)} entries</div>
                          <button
                            type="button"
                            onClick={() => toggleActivityLog(report.user.id)}
                            className="rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
                            aria-expanded={isLogExpanded}
                          >
                            {isLogExpanded ? 'Hide Log' : 'Show Log'}
                          </button>
                        </div>
                      </div>
                      <UserActivityLogPanel
                        userId={report.user.id}
                        isExpanded={isLogExpanded}
                        filterRange={filterRange}
                        customDates={customDates}
                      />
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center">
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </div>
          )}

          <style>{`
            @media print {
              @page { size: A4; margin: 0.35in; }
              body { background: white; }
              .no-print { display: none !important; }
              .print-overflow-reset { overflow: visible !important; }
              .report-cover, .user-report-card { box-shadow: none !important; }
              .user-report-card { page-break-after: always; break-after: page; border-color: #d1d5db !important; }
              .user-report-card:last-of-type { page-break-after: auto; break-after: auto; }
              .activity-table { font-size: 10px; }
              .activity-table thead { display: table-header-group; }
              .activity-table tr { page-break-inside: avoid; break-inside: avoid; }
            }
          `}</style>
        </>
      )}
    </div>
  );
};

export default UserActivityPerformanceReport;
