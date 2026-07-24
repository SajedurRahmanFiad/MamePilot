
import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  CreditCard,
  BarChart3,
  Settings,
  Truck,
  PlusCircle,
  LogOut,
  ChevronRight,
  Search,
  MoreVertical,
  Printer,
  Download,
  Copy,
  Edit,
  Trash2,
  Plus,
  ArrowRightLeft,
  Briefcase,
  Minus,
  Check,
  AlertCircle,
  Info,
  Wallet,
  Eye,
  ShieldAlert,
  Bell,
  CircleHelp,
  X,
  Clock3,
  RotateCcw,
  TrendingUp
} from 'lucide-react';

const WhatsAppIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="#25D366">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const MessengerIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="#0078FF">
    <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.654V24l4.088-2.242c1.092.301 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111C18 4.974 16.627 0 12 0zm1.193 14.768l-3.059-3.26-5.973 3.26L10.732 8.1l3.177 3.26L19.854 8.1l-6.661 6.668z"/>
  </svg>
);

// Fixed missing properties on ICONS object by adding 'Users' and 'Briefcase' keys
export const ICONS = {
  Dashboard: <LayoutDashboard size={20} />,
  Sales: <ShoppingCart size={20} />,
  Products: <Package size={20} />,
  Customers: <Users size={20} />,
  Vendors: <Briefcase size={20} />,
  Users: <Users size={20} />,
  Briefcase: <Briefcase size={20} />,
  Banking: <CreditCard size={20} />,
  Payroll: <Wallet size={20} />,
  RecycleBin: <Trash2 size={20} />,
  Undoer: <RotateCcw size={20} />,
  Reports: <BarChart3 size={20} />,
  Settings: <Settings size={20} />,
  Courier: <Truck size={20} />,
  Plus: <Plus size={20} />,
  Minus: <Minus size={20} />,
  PlusCircle: <PlusCircle size={20} />,
  LogOut: <LogOut size={20} />,
  ChevronRight: <ChevronRight size={20} />,
  Search: <Search size={18} />,
  More: <MoreVertical size={18} />,
  Print: <Printer size={18} />,
  Download: <Download size={18} />,
  Duplicate: <Copy size={18} />,
  View: <Eye size={18} />,
  Edit: <Edit size={18} />,
  Delete: <Trash2 size={18} />,
  Transfer: <ArrowRightLeft size={18} />,
  Check: <Check size={20} />,
  CheckCircle: <Check size={20} />,
  AlertCircle: <AlertCircle size={20} />,
  Info: <Info size={20} />,
  FraudChecker: <ShieldAlert size={20} />,
  Bell: <Bell size={20} />,
  Help: <CircleHelp size={18} />,
  Close: <X size={18} />,
  Clock: <Clock3 size={18} />,
  Return: <RotateCcw size={20} />,
  TrendingUp: <TrendingUp size={20} />,
  WhatsApp: <WhatsAppIcon />,
  Messenger: <MessengerIcon />
};

export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount).replace('BDT', '৳');
};

export const getStatusColor = (status: string): string => {
  const statusMap: Record<string, string> = {
    'ON_HOLD': 'bg-gray-100 text-gray-600',
    'PROCESSING': 'bg-blue-100 text-blue-600',
    'PICKED': 'bg-purple-100 text-purple-600',
    'COMPLETED': 'bg-green-100 text-green-600',
    'EXCHANGE_PROCESSING': 'bg-blue-100 text-blue-600',
    'EXCHANGE_PICKED': 'bg-purple-100 text-purple-600',
    'EXCHANGE_DELIVERED': 'bg-green-100 text-green-600',
    'EXCHANGE_RETURNED': 'bg-orange-100 text-orange-700',
    'EXCHANGE_CANCELLED': 'bg-red-100 text-red-600',
    'RETURNED': 'bg-orange-100 text-orange-700',
    'CANCELLED': 'bg-red-100 text-red-600',
    'COURIER_ASSIGNED': 'bg-blue-100 text-blue-600',
    'RECEIVED': 'bg-green-100 text-green-600',
    'On Hold': 'bg-gray-100 text-gray-600',
    'Processing': 'bg-blue-100 text-blue-600',
    'Courier assigned': 'bg-blue-100 text-blue-600',
    'Picked': 'bg-purple-100 text-purple-600',
    'Completed': 'bg-green-100 text-green-600',
    'Exchange processing': 'bg-blue-100 text-blue-600',
    'Exchange picked': 'bg-purple-100 text-purple-600',
    'Exchange delivered': 'bg-green-100 text-green-600',
    'Exchange returned': 'bg-orange-100 text-orange-700',
    'Exchange cancelled': 'bg-red-100 text-red-600',
    'Returned': 'bg-orange-100 text-orange-700',
    'Cancelled': 'bg-red-100 text-red-600',
    'Received': 'bg-green-100 text-green-600',
  };
  return statusMap[status] || 'bg-gray-100 text-gray-600';
};

export const getPaymentStatusLabel = (paidAmount: number, total: number, history?: Record<string, string | undefined> | null): string => {
  const historyText = history ? Object.values(history).filter(Boolean).join(' ') : '';
  const normalizedPaid = Math.max(0, Number(paidAmount) || 0);
  const normalizedTotal = Math.max(0, Number(total) || 0);
  if (normalizedPaid > normalizedTotal) return 'Overpaid';
  if (normalizedPaid === 0 && historyText && /refund/i.test(historyText)) return 'Refunded';
  if (normalizedTotal === 0) return 'Paid';
  if (normalizedPaid === 0) return 'Unpaid';
  if (normalizedPaid < normalizedTotal) return 'Partially Paid';
  return 'Paid';
};

export const getPaymentStatusBadgeColor = (status: string): string => {
  const statusMap: Record<string, string> = {
    'Unpaid': 'bg-red-100 text-red-600',
    'Paid': 'bg-green-100 text-green-600',
    'Partially paid': 'bg-amber-100 text-amber-700',
    'Partially Paid': 'bg-amber-100 text-amber-700',
    'Refunded': 'bg-orange-100 text-orange-700',
    'Overpaid': 'bg-green-100 text-green-600',
  };
  return statusMap[status] || 'bg-gray-100 text-gray-600';
};

export const getStatusDisplayName = (status: string): string => {
  if (status === 'Completed') return 'Delivered';
  if (status === 'Exchange processing') return 'Exchange Processing';
  if (status === 'Exchange picked') return 'Exchange Picked';
  if (status === 'Exchange delivered') return 'Exchange Delivered';
  if (status === 'Exchange returned') return 'Exchange Returned';
  if (status === 'Exchange cancelled') return 'Exchange Cancelled';
  return status;
};

export const formatNumberWithSuffix = (value: number): { abbreviated: string; full: string } => {
  const absValue = Math.abs(value);
  const numericValue = Number(value);
  
  if (!Number.isFinite(numericValue)) {
    return { abbreviated: '0', full: '0' };
  }

  const fullFormatted = numericValue.toLocaleString('en-BD');
  
  if (absValue >= 1_000_000_000) {
    const billions = (numericValue / 1_000_000_000).toFixed(1);
    return {
      abbreviated: `${billions}B`,
      full: fullFormatted,
    };
  }
  
  if (absValue >= 1_000_000) {
    const millions = (numericValue / 1_000_000).toFixed(1);
    return {
      abbreviated: `${millions}M`,
      full: fullFormatted,
    };
  }
  
  if (absValue >= 1_000) {
    const thousands = (numericValue / 1_000).toFixed(1);
    return {
      abbreviated: `${thousands}K`,
      full: fullFormatted,
    };
  }
  
  return {
    abbreviated: fullFormatted,
    full: fullFormatted,
  };
};
