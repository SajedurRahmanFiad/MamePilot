import React, { useMemo } from 'react';
import { StatCard, Card } from '../components/Card';
import { ICONS } from '../constants';
import { useUsers } from '../src/hooks/useQueries';

const HumanResourceDashboard: React.FC = () => {
  const { data: users = [], isLoading } = useUsers();

  const stats = useMemo(() => {
    const activeUsers = users.filter((user) => !user.deletedAt);
    const employees = activeUsers.filter((user) => user.role === 'Employee');
    const managers = activeUsers.filter((user) => user.role !== 'Employee' && user.role !== 'User');
    const recentHires = activeUsers.filter((user) => {
      if (!user.createdAt) return false;
      const createdAt = new Date(user.createdAt);
      if (Number.isNaN(createdAt.getTime())) return false;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      return createdAt >= cutoff;
    });

    return {
      totalEmployees: employees.length,
      activePeople: activeUsers.length,
      managers: managers.length,
      recentHires: recentHires.length,
    };
  }, [users]);

  const renderValue = (value: number) => (isLoading ? 'Loading...' : value.toLocaleString('en-BD'));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-6 py-6 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#0f2f57]">Human Resource</p>
          <h1 className="mt-2 text-2xl font-black text-gray-900">People dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-500">
            A quick overview of the team strength, activity, and staffing momentum for the current period.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total Employees" value={renderValue(stats.totalEmployees)} icon={ICONS.Users} bgColor="bg-[#0f2f57]" textColor="text-white" iconBgColor="bg-[#163a6b]" />
        <StatCard title="Active People" value={renderValue(stats.activePeople)} icon={ICONS.Check} bgColor="bg-emerald-600" textColor="text-white" iconBgColor="bg-emerald-700" />
        <StatCard title="Managers" value={renderValue(stats.managers)} icon={ICONS.Briefcase} bgColor="bg-amber-500" textColor="text-white" iconBgColor="bg-amber-600" />
        <StatCard title="New Hires (30d)" value={renderValue(stats.recentHires)} icon={ICONS.PlusCircle} bgColor="bg-sky-600" textColor="text-white" iconBgColor="bg-sky-700" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card elevated className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Team summary</p>
              <h2 className="mt-2 text-lg font-black text-gray-900">Current staffing snapshot</h2>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-sm font-semibold text-gray-500">Employee coverage</p>
              <p className="mt-2 text-2xl font-black text-gray-900">{renderValue(stats.totalEmployees)} active employees</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-sm font-semibold text-gray-500">Leadership presence</p>
              <p className="mt-2 text-2xl font-black text-gray-900">{renderValue(stats.managers)} managers and admins</p>
            </div>
          </div>
        </Card>

        <Card elevated className="p-6">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Next steps</p>
          <ul className="mt-4 space-y-3 text-sm text-gray-600">
            <li className="rounded-lg border border-gray-100 bg-white p-3">Review payroll and attendance trends for the month.</li>
            <li className="rounded-lg border border-gray-100 bg-white p-3">Track onboarding progress for new hires.</li>
            <li className="rounded-lg border border-gray-100 bg-white p-3">Keep employee records updated in the users section.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
};

export default HumanResourceDashboard;
