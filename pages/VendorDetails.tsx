
import React, { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Bill, BillStatus } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { theme } from '../theme';
import { useVendor, useBillsByVendorId } from '../src/hooks/useQueries';
import { buildHistoryBackState, getPreservedRouteState } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

const VendorDetails: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: vendor, isPending: loading } = useVendor(id || '');
  const { data: vendorBills = [] } = useBillsByVendorId(vendor?.id);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const { canAccessRecord, canEditVendors } = useRolePermissions();

  if (loading) return <div className="p-8 text-center text-gray-500">Loading vendor details...</div>;
  if (!vendor) return <div className="p-8 text-center text-gray-500">Vendor not found.</div>;

  const getStatusColor = (status: BillStatus) => {
    switch (status) {
      case BillStatus.ON_HOLD: return 'bg-gray-100 text-gray-600';
      case BillStatus.PROCESSING: return 'bg-blue-100 text-blue-600';
      case BillStatus.RECEIVED: return 'bg-green-100 text-green-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => {
            const navState = getPreservedRouteState(location.state);
            if (navState.backMode === 'history' && window.history.length > 1) {
              navigate(-1);
              return;
            }

            if (navState.from) {
              navigate(navState.from);
              return;
            }

            navigate('/vendors');
          }} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </button>
          <h2 className="text-2xl font-bold text-gray-900">Vendor Profile</h2>
        </div>
        <div className="flex gap-2">
          {canEditVendors && (
            <button onClick={() => navigate(`/vendors/edit/${id}`)} className="px-4 py-2 border rounded-xl font-bold bg-white text-gray-700 hover:bg-gray-50">Edit Profile</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Profile Info */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 text-center">
            <div className={`w-24 h-24 rounded-full bg-[#e6f0ff] ${theme.colors.primary.text} flex items-center justify-center font-black text-4xl mx-auto mb-4 border-2 border-[#c7dff5]`}>
              {vendor.name.charAt(0)}
            </div>
            <h3 className="text-xl font-bold text-gray-900">{vendor.name}</h3>
            <p className="text-sm text-gray-400 mt-1">{vendor.phone}</p>
            
            <div className="mt-6 pt-6 border-t border-gray-50 space-y-4 text-left">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Office Address</p>
                <p className="text-sm text-gray-700 font-medium leading-relaxed">{vendor.address}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Procurement</p>
                <p className="text-lg font-black text-gray-900">{formatCurrency(vendorBills.reduce((s, b) => s + b.total, 0))}</p>
              </div>
            </div>
          </div>

          <div className="bg-[var(--primary-soft,#ebf4ff)] p-6 rounded-lg shadow-lg shadow-[var(--primary-color,#0f2f57)]/20 text-white">
            <p className="text-[var(--primary-color,#0f2f57)] text-[10px] font-bold uppercase tracking-wider mb-1">Total Payable</p>
            <h4 className="text-lg font-black text-red-600">{formatCurrency(vendor.dueAmount)}</h4>
          </div>
        </div>

        {/* Right Bill List */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Purchase Bills</h3>
              <span className="text-xs font-bold text-gray-400">{vendorBills.length} Invoices</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="px-6 py-4">Bill Number</th>
                    <th className="px-6 py-4">Bill Date</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {vendorBills.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-gray-400 italic">No purchase bills found for this vendor.</td>
                    </tr>
                  ) : (
                    vendorBills.map((bill) => (
                      <tr 
                        key={bill.id}
                        onMouseEnter={() => setHoveredRow(bill.id)}
                        onMouseLeave={() => setHoveredRow(null)}
                        onClick={() => navigate(`/bills/${bill.id}`, { state: buildHistoryBackState(location) })}
                        className="group relative hover:bg-blue-50/30 cursor-pointer transition-colors"
                      >
                        <td className="px-6 py-4">
                          <span className="font-bold text-gray-900">#{bill.billNumber}</span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">{bill.billDate}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${getStatusColor(bill.status)}`}>
                            {bill.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-black text-gray-900">{formatCurrency(bill.total)}</span>
                        </td>

                        {hoveredRow === bill.id && canAccessRecord(bill.createdBy, 'bills.editOwn', 'bills.editAny') && (
                          <td className="absolute inset-y-0 right-0 flex items-center pr-6 bg-gradient-to-l from-blue-50 via-blue-50 to-transparent">
                            <div className="flex items-center gap-1 bg-white p-1 rounded-lg shadow-lg border border-[#c7dff5] animate-in fade-in slide-in-from-right-2 duration-200" onClick={e => e.stopPropagation()}>
                              <button title="Edit" onClick={() => navigate(`/bills/edit/${bill.id}`)} className={`p-2 text-gray-500 hover:${theme.colors.primary[600]} hover:bg-[#ebf4ff] rounded-md transition-colors`}>
                                {ICONS.Edit}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VendorDetails;
