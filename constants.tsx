
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
  RotateCcw
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
  AlertCircle: <AlertCircle size={20} />,
  Info: <Info size={20} />,
  FraudChecker: <ShieldAlert size={20} />,
  Bell: <Bell size={20} />,
  Help: <CircleHelp size={18} />,
  Close: <X size={18} />,
  Clock: <Clock3 size={18} />,
  Return: <RotateCcw size={20} />
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
    'RETURNED': 'bg-orange-100 text-orange-700',
    'CANCELLED': 'bg-red-100 text-red-600',
    'COURIER_ASSIGNED': 'bg-blue-100 text-blue-600',
    'RECEIVED': 'bg-green-100 text-green-600',
    'On Hold': 'bg-gray-100 text-gray-600',
    'Processing': 'bg-blue-100 text-blue-600',
    'Courier assigned': 'bg-blue-100 text-blue-600',
    'Picked': 'bg-purple-100 text-purple-600',
    'Completed': 'bg-green-100 text-green-600',
    'Returned': 'bg-orange-100 text-orange-700',
    'Cancelled': 'bg-red-100 text-red-600',
    'Received': 'bg-green-100 text-green-600',
  };
  return statusMap[status] || 'bg-gray-100 text-gray-600';
};
