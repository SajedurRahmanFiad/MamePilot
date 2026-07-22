
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
  TrendingUp,
  MessageSquare,
  MessageCircle
} from 'lucide-react';

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
  WhatsApp: <MessageSquare size={20} />,
  Messenger: <MessageCircle size={20} />
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
