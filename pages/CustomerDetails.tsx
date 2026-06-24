
import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Order, OrderStatus } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { useCustomer, useOrdersByCustomerId, useOrderSettings, useUsers } from '../src/hooks/useQueries';
import { useCreateOrder } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useAuth } from '../src/contexts/AuthProvider';
import { buildHistoryBackState, getPreservedRouteState } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { getTodayDate } from '../utils';

const CustomerDetails: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const { user } = useAuth();
  
  // Query data - ALL HOOKS MUST BE AT TOP, CALLED UNCONDITIONALLY
  const { data: customer } = useCustomer(id || '');
  const { data: customerOrders = [] } = useOrdersByCustomerId(id || '');
  const { data: orderSettings } = useOrderSettings();
  const { data: users = [] } = useUsers();
  
  // Mutations
  const createMutation = useCreateOrder();
  const toast = useToastNotifications();

  const { can, canAccessRecord } = useRolePermissions();
  const canEditCustomers = can('customers.edit');
  const canCreateOrders = can('orders.create');
  const userMap = useMemo(() => new Map(users.map((entry) => [entry.id, entry.name])), [users]);

  // Calculate totals from orders - MOVED TO TOP BEFORE CONDITIONALS
  const { totalRevenue, dueAmount } = useMemo(() => {
    const completedOrders = customerOrders.filter(o => o.status === OrderStatus.COMPLETED);
    const pendingOrders = customerOrders.filter(o => o.status === OrderStatus.PROCESSING || o.status === OrderStatus.PICKED);
    
    const totalRevenue = completedOrders.reduce((sum, o) => sum + o.total, 0);
    const dueAmount = pendingOrders.reduce((sum, o) => sum + (o.total - o.paidAmount), 0);
    
    return { totalRevenue, dueAmount };
  }, [customerOrders]);

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.ON_HOLD: return 'bg-gray-100 text-gray-600';
      case OrderStatus.PROCESSING: return 'bg-[#e6f0ff] text-[#3c5a82]';
      case OrderStatus.PICKED: return 'bg-purple-100 text-purple-600';
      case OrderStatus.COMPLETED: return 'bg-green-100 text-green-600';
      case OrderStatus.RETURNED: return 'bg-orange-100 text-orange-700';
      case OrderStatus.CANCELLED: return 'bg-red-100 text-red-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const handleDuplicate = async (order: Order) => {
    if (!canCreateOrders) {
      toast.error('You do not have permission to create orders.');
      return;
    }
    try {
      if (!customer) return;
      
      if (!orderSettings) {
        toast.error('Unable to generate new order number. Please try again.');
        return;
      }

      const newOrderNumber = `${orderSettings.prefix}${orderSettings.nextNumber}`;
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' });

      const newOrder = {
        orderNumber: newOrderNumber,
        orderDate: getTodayDate(),
        customerId: customer.id,
        pageId: order.pageId,
        pageSnapshot: order.pageSnapshot,
        createdBy: order.createdBy,
        status: OrderStatus.ON_HOLD,
        items: order.items,
        subtotal: order.subtotal,
        discount: order.discount,
        shipping: order.shipping,
        total: order.total,
        paidAmount: 0,
        history: {
          created: `Duplicated from order #${order.orderNumber} on ${dateStr}, at ${timeStr}`
        }
      };

      await createMutation.mutateAsync(newOrder as any);
      toast.success('Order duplicated successfully');
      navigate('/orders');
    } catch (error) {
      console.error('Failed to duplicate order', error);
      toast.error('Failed to duplicate order: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  if (!customer) {
    return <div className="p-8 text-center text-gray-500">Customer not found.</div>;
  }

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

            navigate('/customers');
          }} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </button>
          <h2 className="text-2xl font-bold text-gray-900">Customer Profile</h2>
        </div>
        <div className="flex gap-2">
          {canEditCustomers && (
            <button onClick={() => navigate(`/customers/edit/${id}`)} className="px-4 py-2 border rounded-xl font-bold bg-white text-gray-700 hover:bg-gray-50">Edit Profile</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Profile Info */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 text-center">
            <div className="w-24 h-24 rounded-full overflow-hidden mx-auto mb-4 border-2 border-[var(--primary-medium,#3c5a82)]">
              <img
                src="/uploads/Empty_avatar.png"
                alt={customer.name}
                className="w-full h-full object-cover"
              />
            </div>
            <h3 className="text-xl font-bold text-gray-900">{customer.name}</h3>
            <p className="text-sm text-gray-400 mt-1">{customer.phone}</p>
            
            <div className="mt-6 pt-6 border-t border-gray-50 space-y-4 text-left">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Address</p>
                <p className="text-sm text-gray-700 font-medium leading-relaxed">{customer.address}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Revenue</p>
                <p className="text-lg font-black text-gray-900">{formatCurrency(totalRevenue)}</p>
              </div>
            </div>
          </div>

          <div className="bg-[var(--primary-color,#0f2f57)] p-6 rounded-lg shadow-lg shadow-[var(--primary-color,#0f2f57)]/20 border border-[var(--primary-color,#0f2f57)] text-white">
            <p className="text-[var(--primary-soft,#ebf4ff)] text-[10px] font-bold uppercase tracking-wider mb-1">Due Amount</p>
            <h4 className="text-lg font-black">{formatCurrency(dueAmount)}</h4>
          </div>
        </div>

        {/* Right Order List */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-50 flex items-center justify-between">
              <h3 className="font-bold text-gray-900">Order History</h3>
              <span className="text-xs font-bold text-gray-400">{customerOrders.length} Records found</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 text-xs font-bold text-gray-500 uppercase tracking-wider">
                    <th className="px-6 py-4">Order Number</th>
                    <th className="px-6 py-4">Order Date</th>
                    <th className="px-6 py-4">Created By</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {customerOrders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-gray-400 italic">No orders found for this customer.</td>
                    </tr>
                  ) : (
                    customerOrders.map((order) => (
                      (() => {
                        const creatorName = order.creatorName || userMap.get(order.createdBy) || '—';
                        const canEditOrder =
                          order.status === OrderStatus.ON_HOLD &&
                          (can('orders.editAny') || canAccessRecord(order.createdBy, 'orders.editOwn', 'orders.editAny'));
                        const canShowOrderActions = canEditOrder || canCreateOrders;

                        return (
                          <tr 
                            key={order.id}
                            onMouseEnter={() => setHoveredRow(order.id)}
                            onMouseLeave={() => setHoveredRow(null)}
                            onClick={() => navigate(`/orders/${order.id}`, { state: buildHistoryBackState(location) })}
                            className="group relative hover:bg-[#ebf4ff]/30 cursor-pointer transition-colors"
                          >
                            <td className="px-6 py-4">
                              <span className="font-bold text-gray-900">#{order.orderNumber}</span>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">{order.orderDate}</td>
                            <td className="px-6 py-4 text-sm font-semibold text-gray-600">{creatorName}</td>
                            <td className="px-6 py-4">
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${getStatusColor(order.status)}`}>
                                {order.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="font-black text-gray-900">{formatCurrency(order.total)}</span>
                            </td>

                            {hoveredRow === order.id && canShowOrderActions && (
                              <td className="absolute inset-y-0 right-0 flex items-center pr-6 bg-gradient-to-l from-emerald-50 via-emerald-50 to-transparent">
                                <div className="flex items-center gap-1 bg-white p-1 rounded-lg shadow-lg border border-[#c7dff5] animate-in fade-in slide-in-from-right-2 duration-200" onClick={e => e.stopPropagation()}>
                                  {canEditOrder && (
                                    <button title="Edit" onClick={() => navigate(`/orders/edit/${order.id}`)} className="p-2 text-gray-500 hover:text-[#0f2f57] hover:bg-[#ebf4ff] rounded-md transition-colors">
                                      {ICONS.Edit}
                                    </button>
                                  )}
                                  {canCreateOrders && (
                                    <button title="Duplicate" onClick={() => handleDuplicate(order)} className="p-2 text-gray-500 hover:text-[#0f2f57] hover:bg-[#ebf4ff] rounded-md transition-colors">
                                      {ICONS.Duplicate}
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })()
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

export default CustomerDetails;




