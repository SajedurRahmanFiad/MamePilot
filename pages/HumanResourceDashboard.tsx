import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  FileWarning,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { Button } from '../components';
import { formatCurrency } from '../constants';
import { useEmployeeWalletCardsPage, useUsers } from '../src/hooks/useQueries';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { formatDate } from '../utils';

const DAY_MS = 24 * 60 * 60 * 1000;

type DashboardMetricProps = {
  label: string;
  value: React.ReactNode;
  helper: string;
  icon: React.ReactNode;
  iconTone: string;
  loading?: boolean;
};

const DashboardMetric: React.FC<DashboardMetricProps> = ({
  label,
  value,
  helper,
  icon,
  iconTone,
  loading = false,
}) => (
  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">{label}</p>
        {loading ? (
          <div className="mt-3 h-7 w-24 animate-pulse rounded-lg bg-gray-100" />
        ) : (
          <p className="mt-2 text-xl font-black text-gray-900 sm:text-2xl">{value}</p>
        )}
      </div>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconTone}`}>
        {icon}
      </span>
    </div>
    <p className="mt-3 text-xs font-medium leading-relaxed text-gray-500">{helper}</p>
  </div>
);

const ProgressRow: React.FC<{
  label: string;
  value: number;
  total: number;
  tone: string;
  suffix?: string;
}> = ({ label, value, total, tone, suffix }) => {
  const width = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-bold text-gray-700">{label}</span>
        <span className="font-black text-gray-900">{value.toLocaleString('en-BD')}{suffix}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
};

const getUpcomingBirthday = (value?: string | null) => {
  const raw = String(value || '').slice(0, 10);
  const match = raw.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  let nextDate = new Date(today.getFullYear(), month, day);
  if (nextDate < today) nextDate = new Date(today.getFullYear() + 1, month, day);

  return {
    date: nextDate,
    daysUntil: Math.round((nextDate.getTime() - today.getTime()) / DAY_MS),
  };
};

const getInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'U';

const HumanResourceDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { can, canCreateUsers } = useRolePermissions();
  const { hasSubCapability } = useCapabilities();
  const canViewPayroll = can('payroll.view') && hasSubCapability('payroll');
  const { data: users = [], isPending: usersLoading, isError: usersError } = useUsers();
  const {
    data: walletPage = {
      data: [],
      count: 0,
      summary: {
        totalBalance: 0,
        totalEarned: 0,
        totalPaid: 0,
        employeesDue: 0,
        fixedSalaryEmployees: 0,
        totalFixedSalaryDue: 0,
      },
    },
    isPending: walletsLoading,
    isError: walletsError,
  } = useEmployeeWalletCardsPage(1, 5, { enabled: canViewPayroll });

  const dashboard = useMemo(() => {
    const activePeople = users.filter((user) => !user.deletedAt);
    const employees = activePeople.filter((user) => user.role === 'Employee');
    const fixedEmployees = employees.filter((user) => user.isCommissionBased !== true && Number(user.fixedSalary || 0) > 0);
    const commissionEmployees = employees.filter((user) => user.isCommissionBased === true);
    const compensationReady = employees.filter((user) =>
      user.isCommissionBased === true || Number(user.fixedSalary || 0) > 0
    );
    const incompleteProfiles = employees.filter((user) =>
      !String(user.phone || '').trim()
      || !String(user.email || '').trim()
      || !String(user.address || '').trim()
      || !String(user.birthday || '').trim()
    );

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const recentHires = employees
      .filter((user) => {
        if (!user.createdAt) return false;
        const joinedAt = new Date(user.createdAt);
        return !Number.isNaN(joinedAt.getTime()) && joinedAt >= cutoff;
      })
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

    const birthdays = employees
      .map((employee) => ({ employee, upcoming: getUpcomingBirthday(employee.birthday) }))
      .filter((item): item is typeof item & { upcoming: NonNullable<typeof item.upcoming> } => !!item.upcoming)
      .filter((item) => item.upcoming.daysUntil <= 30)
      .sort((left, right) => left.upcoming.daysUntil - right.upcoming.daysUntil);

    const roleCounts = Array.from(
      activePeople.reduce((counts, user) => {
        counts.set(user.role, (counts.get(user.role) || 0) + 1);
        return counts;
      }, new Map<string, number>())
    )
      .map(([role, count]) => ({ role, count }))
      .sort((left, right) => right.count - left.count);

    return {
      activePeople,
      employees,
      fixedEmployees,
      commissionEmployees,
      compensationReady,
      incompleteProfiles,
      recentHires,
      birthdays,
      roleCounts,
    };
  }, [users]);

  const compensationSetupPercent = dashboard.employees.length > 0
    ? Math.round((dashboard.compensationReady.length / dashboard.employees.length) * 100)
    : 0;

  return (
    <div className="space-y-5 pb-10 sm:space-y-6">
      <header className="overflow-hidden rounded-2xl border border-[#d6e3f0] bg-gradient-to-br from-[#f8fbff] via-white to-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#3c5a82]">Human Resource</p>
            <h1 className="mt-2 text-2xl font-black text-gray-900 sm:text-3xl">People & payroll overview</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-gray-500">
              See workforce readiness, compensation setup, upcoming people events, and payroll attention points in one place.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => navigate('/users')}>
              Manage people
            </Button>
            {canCreateUsers && (
              <Button type="button" variant="outline" size="sm" icon={<UserPlus size={16} />} onClick={() => navigate('/users/new')}>
                Add employee
              </Button>
            )}
            {canViewPayroll && (
              <Button type="button" variant="primary" size="sm" icon={<ArrowRight size={16} />} onClick={() => navigate('/payroll')}>
                Open payroll
              </Button>
            )}
          </div>
        </div>
      </header>

      {usersError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          People data could not be loaded. Refresh the page to try again.
        </div>
      )}
      {canViewPayroll && walletsError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          Payroll balances could not be loaded. Outstanding liabilities are marked unavailable until the data refresh succeeds.
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        <DashboardMetric
          label="Active employees"
          value={dashboard.employees.length.toLocaleString('en-BD')}
          helper={`${dashboard.activePeople.length.toLocaleString('en-BD')} active user accounts overall`}
          icon={<UsersRound size={20} />}
          iconTone="bg-[#e8f0fa] text-[#0f2f57]"
          loading={usersLoading}
        />
        <DashboardMetric
          label="Joined in 30 days"
          value={dashboard.recentHires.length.toLocaleString('en-BD')}
          helper="New employees who may need onboarding follow-up"
          icon={<UserPlus size={20} />}
          iconTone="bg-sky-100 text-sky-700"
          loading={usersLoading}
        />
        <DashboardMetric
          label="Payroll readiness"
          value={`${compensationSetupPercent}%`}
          helper={`${dashboard.compensationReady.length} of ${dashboard.employees.length} employees have a usable pay basis`}
          icon={<CircleDollarSign size={20} />}
          iconTone="bg-emerald-100 text-emerald-700"
          loading={usersLoading}
        />
        <DashboardMetric
          label="Outstanding payroll"
          value={!canViewPayroll ? 'Restricted' : walletsError ? 'Unavailable' : formatCurrency(walletPage.summary.totalBalance)}
          helper={canViewPayroll
            ? walletsError
              ? 'Payroll balances could not be verified'
              : `${walletPage.summary.employeesDue} employees currently have a payable balance`
            : 'Payroll permission is required to view balances'}
          icon={<FileWarning size={20} />}
          iconTone="bg-amber-100 text-amber-700"
          loading={canViewPayroll && walletsLoading && !walletsError}
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Workforce structure</p>
              <h2 className="mt-2 text-lg font-black text-gray-900">Team and compensation mix</h2>
              <p className="mt-1 text-sm font-medium text-gray-500">A clear view of how employees are paid and where setup is incomplete.</p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-black text-gray-600">
              {dashboard.employees.length} employees
            </span>
          </div>

          <div className="mt-6 space-y-5">
            <ProgressRow
              label="Fixed salary"
              value={dashboard.fixedEmployees.length}
              total={Math.max(1, dashboard.employees.length)}
              tone="bg-violet-500"
            />
            <ProgressRow
              label="Commission based"
              value={dashboard.commissionEmployees.length}
              total={Math.max(1, dashboard.employees.length)}
              tone="bg-[#3c5a82]"
            />
            <ProgressRow
              label="Pay basis configured"
              value={dashboard.compensationReady.length}
              total={Math.max(1, dashboard.employees.length)}
              tone="bg-emerald-500"
            />
          </div>

          {dashboard.compensationReady.length < dashboard.employees.length && !usersLoading && (
            <button
              type="button"
              onClick={() => navigate('/users')}
              className="mt-6 flex w-full items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left transition hover:bg-amber-100"
            >
              <span>
                <span className="block text-sm font-black text-amber-900">
                  {dashboard.employees.length - dashboard.compensationReady.length} employee records need a pay basis
                </span>
                <span className="mt-0.5 block text-xs font-medium text-amber-700">Add a fixed salary or confirm commission-based pay before payroll.</span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-amber-700" />
            </button>
          )}
        </article>

        <article className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Payroll attention</p>
              <h2 className="mt-2 text-lg font-black text-gray-900">Balances requiring action</h2>
              <p className="mt-1 text-sm font-medium text-gray-500">Employees with the highest current outstanding balances.</p>
            </div>
            {canViewPayroll && (
              <button type="button" onClick={() => navigate('/payroll')} className="text-xs font-black text-[#0f2f57] hover:underline">
                View all
              </button>
            )}
          </div>

          {!canViewPayroll ? (
            <div className="mt-6 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center text-sm font-medium text-gray-500">
              Payroll balances are hidden for this role.
            </div>
          ) : walletsError ? (
            <div className="mt-6 rounded-xl border border-dashed border-rose-200 bg-rose-50 px-5 py-10 text-center">
              <p className="text-sm font-black text-rose-800">Payroll balances are unavailable</p>
              <p className="mt-1 text-xs font-medium text-rose-700">Refresh before making any settlement decision.</p>
            </div>
          ) : walletsLoading ? (
            <div className="mt-6 space-y-3">
              {[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : walletPage.data.filter((card) => card.currentBalance > 0).length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-emerald-200 bg-emerald-50 px-5 py-10 text-center">
              <p className="text-sm font-black text-emerald-800">No outstanding employee balances</p>
              <p className="mt-1 text-xs font-medium text-emerald-700">Current wallet and salary obligations are settled.</p>
            </div>
          ) : (
            <div className="mt-5 divide-y divide-gray-100">
              {walletPage.data.filter((card) => card.currentBalance > 0).slice(0, 5).map((card) => (
                <button
                  type="button"
                  key={card.employeeId}
                  onClick={() => navigate('/payroll')}
                  className="flex w-full items-center gap-3 py-3 text-left first:pt-0 last:pb-0"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e8f0fa] text-xs font-black text-[#0f2f57]">
                    {getInitials(card.employeeName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-gray-900">{card.employeeName}</span>
                    <span className="mt-0.5 block text-[10px] font-black uppercase tracking-wider text-gray-400">
                      {card.isCommissionBased ? 'Commission' : 'Fixed salary'}
                    </span>
                  </span>
                  <span className="text-sm font-black text-gray-900">{formatCurrency(card.currentBalance)}</span>
                </button>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <article className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700"><CalendarDays size={18} /></span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Next 30 days</p>
              <h2 className="text-base font-black text-gray-900">Upcoming birthdays</h2>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {usersLoading ? (
              [0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-xl bg-gray-100" />)
            ) : dashboard.birthdays.length === 0 ? (
              <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm font-medium text-gray-500">No upcoming birthdays recorded.</p>
            ) : dashboard.birthdays.slice(0, 4).map(({ employee, upcoming }) => (
              <div key={employee.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-gray-900">{employee.name}</p>
                  <p className="mt-0.5 text-xs font-medium text-gray-500">
                    {upcoming.date.toLocaleDateString('en-BD', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-rose-700">
                  {upcoming.daysUntil === 0 ? 'Today' : `${upcoming.daysUntil}d`}
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><UserPlus size={18} /></span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Recent activity</p>
              <h2 className="text-base font-black text-gray-900">Recently joined</h2>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {usersLoading ? (
              [0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-xl bg-gray-100" />)
            ) : dashboard.recentHires.length === 0 ? (
              <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm font-medium text-gray-500">No employees joined in the last 30 days.</p>
            ) : dashboard.recentHires.slice(0, 4).map((employee) => (
              <button
                type="button"
                key={employee.id}
                onClick={() => navigate(`/users/${employee.id}`)}
                className="flex w-full items-center gap-3 rounded-xl bg-gray-50 px-3 py-3 text-left transition hover:bg-gray-100"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-black text-[#0f2f57]">
                  {getInitials(employee.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-gray-900">{employee.name}</span>
                  <span className="mt-0.5 block text-xs font-medium text-gray-500">Joined {formatDate(employee.createdAt || '')}</span>
                </span>
                <ArrowRight size={15} className="shrink-0 text-gray-400" />
              </button>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><FileWarning size={18} /></span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Data quality</p>
              <h2 className="text-base font-black text-gray-900">People records</h2>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-gray-50 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-gray-600">Profiles needing details</span>
                <span className="text-lg font-black text-gray-900">{dashboard.incompleteProfiles.length}</span>
              </div>
              <p className="mt-1 text-xs font-medium leading-relaxed text-gray-500">Email, address, phone, or birthday is missing.</p>
            </div>

            <div className="rounded-xl bg-gray-50 px-4 py-4">
              <p className="text-sm font-bold text-gray-600">Active accounts by role</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {dashboard.roleCounts.slice(0, 5).map(({ role, count }) => (
                  <span key={role} className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-black text-gray-600">
                    {role} · {count}
                  </span>
                ))}
              </div>
            </div>

            <button type="button" onClick={() => navigate('/users')} className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-black text-gray-700 transition hover:bg-gray-50">
              Review employee records <ArrowRight size={16} />
            </button>
          </div>
        </article>
      </section>
    </div>
  );
};

export default HumanResourceDashboard;
