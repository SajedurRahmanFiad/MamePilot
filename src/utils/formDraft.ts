const ORDER_FORM_DRAFT_KEY = 'mamepilot_order_form_draft';
const BILL_FORM_DRAFT_KEY = 'mamepilot_bill_form_draft';

export interface OrderFormDraft {
  customerId: string;
  pageId: string;
  sourceAdId: string;
  orderDate: string;
  orderNumber: string;
  items: unknown[];
  discount: string;
  shipping: string;
  notes: string;
  orderSmartInput: string;
  smartLookupUsed: boolean;
  smartLookupFound: boolean | null;
}

export interface BillFormDraft {
  vendorId: string;
  billDate: string;
  billNumber: string;
  items: unknown[];
  discount: number;
  shipping: number;
  notes: string;
  billSmartInput: string;
  smartLookupUsed: boolean;
  smartLookupFound: boolean | null;
}

export function saveOrderFormDraft(draft: OrderFormDraft): void {
  try {
    sessionStorage.setItem(ORDER_FORM_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore storage errors
  }
}

export function restoreOrderFormDraft(): OrderFormDraft | null {
  try {
    const raw = sessionStorage.getItem(ORDER_FORM_DRAFT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(ORDER_FORM_DRAFT_KEY);
    return JSON.parse(raw) as OrderFormDraft;
  } catch {
    return null;
  }
}

export function saveBillFormDraft(draft: BillFormDraft): void {
  try {
    sessionStorage.setItem(BILL_FORM_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // ignore storage errors
  }
}

export function restoreBillFormDraft(): BillFormDraft | null {
  try {
    const raw = sessionStorage.getItem(BILL_FORM_DRAFT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(BILL_FORM_DRAFT_KEY);
    return JSON.parse(raw) as BillFormDraft;
  } catch {
    return null;
  }
}
