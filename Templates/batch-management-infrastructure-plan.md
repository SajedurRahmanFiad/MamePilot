# Batch Management Module - Infrastructure Plan

## Context

This document provides a comprehensive implementation plan for a new **Batch Management** capability in MamePilot. This feature enables management of living products (birds, livestock, etc.) in batches with population tracking, age monitoring, and event-based logging.

**Capability Name:** `batch_management`

**Key Differences from Regular Products:**
- **Products**: Track quantity of identical copies (e.g., 50 identical t-shirts)
- **Batches**: Track population of living individuals (e.g., 50 birds where each may have different outcomes)
- Batches include age tracking (years, months, days)
- Batches support event logging (deaths, vaccinations, illnesses, etc.)
- Sale/purchase prices apply per individual in the batch
- Events automatically create stock adjustments and financial transactions

---

## 1. Capability Registration

### 1.1 Type Definitions
**File:** `types.ts`

Add new capability key to the `AppCapabilityKey` union type (around line 1201):
```typescript
export type AppCapabilityKey =
  | 'dashboard'
  | 'inventory'
  | 'batch_management'  // NEW
  | 'sales'
  | // ... rest
```

### 1.2 Capability Configuration
**File:** `src/utils/capabilities.ts`

Add to `CAPABILITY_LABELS`:
```typescript
export const CAPABILITY_LABELS: Record<AppCapabilityKey, string> = {
  // ... existing
  inventory: 'Inventory',
  batch_management: 'Batch Management',
  sales: 'Sales & Customer Management',
  // ...
};
```

Add to `CAPABILITY_DESCRIPTIONS`:
```typescript
export const CAPABILITY_DESCRIPTIONS: Record<AppCapabilityKey, string> = {
  // ... existing
  inventory: 'Product catalog management — create, edit, and search products with pricing, stock quantities, categories, and images.',
  batch_management: 'Living product batch management — create and track batches of living products (birds, livestock) with population counts, age tracking, and event logging for deaths, vaccinations, and other events.',
  // ...
};
```

Add to `DEFAULT_CAPABILITIES`:
```typescript
export const DEFAULT_CAPABILITIES: AppCapabilityMap = {
  // ... existing
  inventory: true,
  batch_management: false,  // Disabled by default
  sales: true,
  // ...
};
```

Add route rule to `ROUTE_CAPABILITY_RULES`:
```typescript
export const ROUTE_CAPABILITY_RULES: Array<{ pattern: RegExp; capability: AppCapabilityKey }> = [
  // ... existing
  { pattern: /^\/products(?:\/|$)/, capability: 'inventory' },
  { pattern: /^\/batches(?:\/|$)|^\/batch-event-history(?:\/|$)/, capability: 'batch_management' },
  // ...
];
```

---

## 2. Database Schema

### 2.1 New Tables
**File:** `backend/schema-only.sql` (Append new migrations)

```sql
-- ============================================
-- BATCH MANAGEMENT MODULE - Database Schema
-- ============================================

-- Batch Categories (separate from product categories)
CREATE TABLE IF NOT EXISTS batch_categories (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(50) DEFAULT '#ebf4ff',
    parent_id VARCHAR(36) NULL,
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    deleted_by VARCHAR(36) NULL,
    FOREIGN KEY (parent_id) REFERENCES batch_categories(id) ON DELETE SET NULL
);

-- Batches Table
CREATE TABLE IF NOT EXISTS batches (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE,
    sku VARCHAR(100) NULL,
    category_id VARCHAR(36) NOT NULL,
    image TEXT DEFAULT '/uploads/Empty_product.png',
    
    -- Population tracking (replaces stock/quantity)
    population INT NOT NULL DEFAULT 0,
    
    -- Age tracking (stored as total days for calculation efficiency)
    average_age_days INT NOT NULL DEFAULT 0,
    
    -- Pricing (per individual, not per batch)
    sale_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    
    -- Metadata
    description TEXT,
    created_by VARCHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    deleted_by VARCHAR(36) NULL,
    
    FOREIGN KEY (category_id) REFERENCES batch_categories(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Batch Event Types (system-defined categories for events)
CREATE TABLE IF NOT EXISTS batch_event_types (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_system BOOLEAN DEFAULT TRUE,
    
    -- Form field configuration
    requires_population_change BOOLEAN DEFAULT FALSE,
    requires_expense_amount BOOLEAN DEFAULT FALSE,
    requires_account_id BOOLEAN DEFAULT FALSE,
    requires_payment_method BOOLEAN DEFAULT FALSE,
    requires_notes BOOLEAN DEFAULT FALSE,
    
    -- Stock adjustment configuration
    stock_adjustment_direction ENUM('increase', 'decrease', 'none') DEFAULT 'none',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_batch_event_type_name (name)
);

-- Batch Events (records of what happened to batches)
CREATE TABLE IF NOT EXISTS batch_events (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    batch_id VARCHAR(36) NOT NULL,
    event_type_id VARCHAR(36) NOT NULL,
    
    -- Event timing
    event_date DATE NOT NULL,
    
    -- Population change tracking
    population_change INT DEFAULT 0,
    population_after INT NOT NULL,
    
    -- Financial tracking
    expense_amount DECIMAL(12,2) DEFAULT 0,
    account_id VARCHAR(36) NULL,
    payment_method VARCHAR(36) NULL,
    
    -- Notes/description
    notes TEXT,
    
    -- Audit tracking
    created_by VARCHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
    FOREIGN KEY (event_type_id) REFERENCES batch_event_types(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    FOREIGN KEY (payment_method) REFERENCES payment_methods(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Batch Stock Adjustments (audit trail for population changes)
CREATE TABLE IF NOT EXISTS batch_stock_adjustments (
    id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
    batch_id VARCHAR(36) NOT NULL,
    change_amount INT NOT NULL,
    direction ENUM('increase', 'decrease') NOT NULL,
    created_by VARCHAR(36) NOT NULL,
    event_id VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (event_id) REFERENCES batch_events(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX idx_batches_category ON batches(category_id);
CREATE INDEX idx_batches_created_by ON batches(created_by);
CREATE INDEX idx_batches_deleted ON batches(deleted_at);
CREATE INDEX idx_batch_events_batch ON batch_events(batch_id);
CREATE INDEX idx_batch_events_type ON batch_events(event_type_id);
CREATE INDEX idx_batch_events_date ON batch_events(event_date);
```

### 2.2 System Data Initialization
**File:** Create `backend/bin/setup_batch_event_types.php`

```php
<?php
require_once dirname(__DIR__, 2) . '/bootstrap.php';

$config = App\Config::load(dirname(__DIR__, 3));
$database = new App\Database($config);

// System batch event types
$systemEventTypes = [
    [
        'name' => 'Death',
        'description' => 'Record deaths in the batch - reduces population',
        'requires_population_change' => true,
        'stock_adjustment_direction' => 'decrease',
    ],
    [
        'name' => 'Birth',
        'description' => 'Record new births added to the batch - increases population',
        'requires_population_change' => true,
        'stock_adjustment_direction' => 'increase',
    ],
    [
        'name' => 'Vaccination',
        'description' => 'Record vaccination events with expense tracking',
        'requires_expense_amount' => true,
        'requires_account_id' => true,
        'requires_payment_method' => true,
        'requires_notes' => true,
    ],
    [
        'name' => 'Treatment',
        'description' => 'Record medical treatments with expense tracking',
        'requires_expense_amount' => true,
        'requires_account_id' => true,
        'requires_payment_method' => true,
        'requires_notes' => true,
    ],
    [
        'name' => 'Illness',
        'description' => 'Record illness outbreaks in the batch',
        'requires_population_change' => true,
        'requires_notes' => true,
    ],
    [
        'name' => 'Transfer In',
        'description' => 'Record individuals transferred into this batch',
        'requires_population_change' => true,
        'stock_adjustment_direction' => 'increase',
    ],
    [
        'name' => 'Transfer Out',
        'description' => 'Record individuals transferred out of this batch',
        'requires_population_change' => true,
        'stock_adjustment_direction' => 'decrease',
    ],
    [
        'name' => 'General Note',
        'description' => 'Add a general observation or note',
        'requires_notes' => true,
    ],
];

foreach ($systemEventTypes as $eventType) {
    $existing = $database->fetchOne(
        "SELECT id FROM batch_event_types WHERE name = ?",
        [$eventType['name']]
    );
    
    if (!$existing) {
        $database->execute(
            "INSERT INTO batch_event_types 
            (name, description, is_system, requires_population_change, 
             requires_expense_amount, requires_account_id, requires_payment_method, 
             requires_notes, stock_adjustment_direction) 
            VALUES (?, ?, TRUE, ?, ?, ?, ?, ?, ?)",
            [
                $eventType['name'],
                $eventType['description'],
                $eventType['requires_population_change'] ?? false,
                $eventType['requires_expense_amount'] ?? false,
                $eventType['requires_account_id'] ?? false,
                $eventType['requires_payment_method'] ?? false,
                $eventType['requires_notes'] ?? false,
                $eventType['stock_adjustment_direction'] ?? 'none',
            ]
        );
        echo "Created event type: {$eventType['name']}\n";
    }
}

// System batch category
$systemCategory = $database->fetchOne(
    "SELECT id FROM batch_categories WHERE name = 'Uncategorized' AND is_system = TRUE"
);

if (!$systemCategory) {
    $database->execute(
        "INSERT INTO batch_categories (name, description, is_system, color) 
        VALUES (?, ?, TRUE, ?)",
        ['Uncategorized', 'Default category for batches', '#ebf4ff']
    );
    echo "Created default batch category: Uncategorized\n";
}

echo "Batch event types setup complete.\n";
```

---

## 3. Type Definitions

### 3.1 Core Types
**File:** `types.ts`

Add new interfaces after the `Product` interface:

```typescript
// ============================================
// BATCH MANAGEMENT TYPES
// ============================================

export interface BatchCategory {
  id: string;
  name: string;
  description?: string;
  color: string;
  parentId?: string;
  isSystem?: boolean;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface Batch {
  id: string;
  name: string;
  slug?: string;
  sku?: string | null;
  categoryId: string;
  image: string;
  
  // Population tracking (replaces stock)
  population: number;
  
  // Age tracking (stored as days, displayed as years/months/days)
  averageAgeDays: number;
  
  // Pricing (per individual in the batch)
  salePrice: number;
  purchasePrice: number;
  
  // Metadata
  description?: string;
  categoryName?: string; // Joined field from batch_categories
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface BatchEventType {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
  
  // Form field requirements
  requiresPopulationChange: boolean;
  requiresExpenseAmount: boolean;
  requiresAccountId: boolean;
  requiresPaymentMethod: boolean;
  requiresNotes: boolean;
  
  // Stock adjustment configuration
  stockAdjustmentDirection: 'increase' | 'decrease' | 'none';
  
  createdAt?: string;
}

export interface BatchEvent {
  id: string;
  batchId: string;
  eventTypeId: string;
  eventTypeName?: string; // Joined field
  
  // Event timing
  eventDate: string;
  
  // Population change
  populationChange: number;
  populationAfter: number;
  
  // Financial tracking
  expenseAmount: number;
  accountId?: string;
  accountName?: string; // Joined field
  paymentMethod?: string;
  paymentMethodName?: string; // Joined field
  
  // Notes
  notes?: string;
  
  // Audit tracking
  createdBy?: string;
  createdByName?: string; // Joined field
  createdAt?: string;
}

export interface BatchEventInput {
  batchId: string;
  eventTypeId: string;
  eventDate: string;
  populationChange?: number;
  expenseAmount?: number;
  accountId?: string;
  paymentMethod?: string;
  notes?: string;
}

export interface AgeComponents {
  years: number;
  months: number;
  days: number;
}

// Add to RecycleBinEntityType
export type RecycleBinEntityType =
  | 'customer'
  | 'order'
  | 'bill'
  | 'transaction'
  | 'user'
  | 'vendor'
  | 'product'
  | 'batch'; // NEW

// Add to Settings type for batch categories support
export interface Settings {
  // ... existing fields
  categories: {
    id: string;
    name: string;
    type: 'Income' | 'Expense' | 'Product' | 'Other' | 'Batch'; // NEW: Added 'Batch'
    color: string;
    parentId?: string;
    isSystem?: boolean;
  }[];
  // ...
}
```

### 3.2 Permission Keys
**File:** `types.ts` (PermissionKey type around line 14)

Add new permission keys:
```typescript
export type PermissionKey =
  | // ... existing permissions
  | 'batches.view'
  | 'batches.create'
  | 'batches.edit'
  | 'batches.delete'
  | 'batch_events.view'
  | 'batch_events.create'
  | 'batch_events.delete';
```

---

## 4. Frontend Components

### 4.1 New Pages

#### 4.1.1 `pages/Batches.tsx`
Clone of `pages/Products.tsx` with modifications:
- Remove unit-related columns and filters
- Replace "Stock" column with "Population" column
- Replace "Quantity" terminology with "Population"
- Add age display column
- Add "Mark Event" button that opens BatchEventModal
- Use batch categories instead of product categories
- Filter by batch category

Key differences from Products.tsx:
```typescript
// Columns configuration
{
  key: 'population',
  label: 'Population',
  align: 'right' as const,
  render: (population: number) => (
    <span className={`font-black ${population <= 0 ? 'text-red-600' : population <= 5 ? 'text-amber-600' : 'text-emerald-600'}`}>
      {population}
    </span>
  ),
},
{
  key: 'averageAgeDays',
  label: 'Avg Age',
  render: (averageAgeDays: number) => formatAge(averageAgeDays),
},

// Add Mark Event button
{can('batch_events.create') && (
  <Button
    onClick={() => setEventModalOpen(true)}
    variant="secondary"
    size="md"
    icon={ICONS.Plus}
  >
    Mark Event
  </Button>
)}
```

#### 4.1.2 `pages/BatchForm.tsx`
Clone of `pages/ProductForm.tsx` with modifications:
- Remove unit field and related logic
- Replace stock field with population field
- Add age input component (years, months, days)
- Use `useBatchCategories()` instead of `useCategories('Product')`
- Remove dynamic pricing section
- Update form state to match Batch interface

Key form fields:
```typescript
// Age input component
<div className="flex flex-col md:flex-row gap-6">
  <div className="flex-1 space-y-1">
    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Average Age</label>
    <div className="flex gap-2">
      <NumericInput
        value={ageComponents.years}
        onChange={value => setAgeComponents({...ageComponents, years: value})}
        className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] px-4 py-3"
        allowDecimals={false}
        min={0}
        placeholder="Years"
      />
      <NumericInput
        value={ageComponents.months}
        onChange={value => setAgeComponents({...ageComponents, months: Math.min(11, Math.max(0, value))})}
        className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] px-4 py-3"
        allowDecimals={false}
        min={0}
        max={11}
        placeholder="Months"
      />
      <NumericInput
        value={ageComponents.days}
        onChange={value => setAgeComponents({...ageComponents, days: Math.min(29, Math.max(0, value))})}
        className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] px-4 py-3"
        allowDecimals={false}
        min={0}
        max={29}
        placeholder="Days"
      />
    </div>
  </div>
</div>

// Population field (replaces stock)
<div className="flex flex-col md:flex-row gap-6">
  <div className="flex-1 space-y-1">
    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Population</label>
    <NumericInput
      value={form.population ?? 0}
      onChange={value => setForm({ ...form, population: Math.max(0, value) })}
      className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] px-4 py-3"
      allowDecimals={false}
    />
  </div>
</div>
```

#### 4.1.3 `pages/BatchEventHistory.tsx`
New page for viewing all batch events:
- Table with columns: Date, Batch, Event Type, Population Change, Expense, Account, Notes, Recorded By
- Filterable by batch, event type, date range
- Pagination support
- Click event to view full details

#### 4.1.4 `components/BatchEventModal.tsx`
New modal component for recording batch events:

```typescript
interface BatchEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const BatchEventModal: React.FC<BatchEventModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { data: batches = [] } = useBatchesPage(1, 10000);
  const { data: eventTypes = [] } = useBatchEventTypes();
  const { data: accounts = [] } = useAccounts();
  const { data: paymentMethods = [] } = usePaymentMethods();
  
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [selectedEventType, setSelectedEventType] = useState<BatchEventType | null>(null);
  const [eventDate, setEventDate] = useState<string>(formatDate(new Date()));
  const [populationChange, setPopulationChange] = useState<number>(0);
  const [expenseAmount, setExpenseAmount] = useState<number>(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  
  const createEventMutation = useCreateBatchEvent();
  
  const selectedBatch = batches.find(b => b.id === selectedBatchId);
  
  const handleSubmit = async () => {
    if (!selectedBatchId || !selectedEventType) return;
    
    await createEventMutation.mutateAsync({
      batchId: selectedBatchId,
      eventTypeId: selectedEventType.id,
      eventDate,
      populationChange: selectedEventType.requiresPopulationChange ? populationChange : 0,
      expenseAmount: selectedEventType.requiresExpenseAmount ? expenseAmount : 0,
      accountId: selectedEventType.requiresAccountId ? selectedAccountId : undefined,
      paymentMethod: selectedEventType.requiresPaymentMethod ? selectedPaymentMethod : undefined,
      notes: selectedEventType.requiresNotes ? notes : undefined,
    });
    
    onSuccess?.();
    onClose();
    resetForm();
  };
  
  // Dynamic form rendering based on event type requirements
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Record Batch Event" size="lg">
      <div className="space-y-4">
        {/* Batch Selection */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Batch</label>
          <select
            className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]"
            value={selectedBatchId}
            onChange={e => setSelectedBatchId(e.target.value)}
          >
            <option value="">Select Batch...</option>
            {batches.map(batch => (
              <option key={batch.id} value={batch.id}>
                {batch.name} (Population: {batch.population})
              </option>
            ))}
          </select>
        </div>
        
        {/* Event Type Selection */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Event Type</label>
          <select
            className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]"
            value={selectedEventType?.id || ''}
            onChange={e => {
              const et = eventTypes.find(et => et.id === e.target.value);
              setSelectedEventType(et || null);
            }}
          >
            <option value="">Select Event Type...</option>
            {eventTypes.map(et => (
              <option key={et.id} value={et.id}>{et.name}</option>
            ))}
          </select>
        </div>
        
        {/* Event Date */}
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Event Date</label>
          <input
            type="date"
            className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]"
            value={eventDate}
            onChange={e => setEventDate(e.target.value)}
          />
        </div>
        
        {/* Dynamic Fields Based on Event Type */}
        {selectedEventType && (
          <>
            {selectedEventType.requiresPopulationChange && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                  Population Change
                </label>
                <NumericInput
                  value={populationChange}
                  onChange={setPopulationChange}
                  className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] px-4 py-3"
                  allowDecimals={false}
                  min={selectedEventType.stockAdjustmentDirection === 'decrease' ? -selectedBatch?.population : 0}
                  max={selectedEventType.stockAdjustmentDirection === 'increase' ? 9999 : selectedBatch?.population}
                />
              </div>
            )}
            
            {selectedEventType.requiresExpenseAmount && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                  Expense Amount (BDT)
                </label>
                <NumericInput
                  value={expenseAmount}
                  onChange={setExpenseAmount}
                  className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] px-4 py-3"
                  allowDecimals={true}
                  decimalPlaces={2}
                  min={0}
                />
              </div>
            )}
            
            {selectedEventType.requiresAccountId && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                  Account
                </label>
                <select
                  className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]"
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                >
                  <option value="">Select Account...</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
              </div>
            )}
            
            {selectedEventType.requiresPaymentMethod && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                  Payment Method
                </label>
                <select
                  className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]"
                  value={selectedPaymentMethod}
                  onChange={e => setSelectedPaymentMethod(e.target.value)}
                >
                  <option value="">Select Payment Method...</option>
                  {paymentMethods.map(pm => (
                    <option key={pm.id} value={pm.id}>{pm.name}</option>
                  ))}
                </select>
              </div>
            )}
            
            {selectedEventType.requiresNotes && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                  Notes
                </label>
                <textarea
                  className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] min-h-[100px]"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Enter event details..."
                />
              </div>
            )}
          </>
        )}
        
        <div className="flex gap-4 justify-end pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button 
            variant="primary" 
            onClick={handleSubmit}
            disabled={!selectedBatchId || !selectedEventType || createEventMutation.isPending}
          >
            {createEventMutation.isPending ? 'Recording...' : 'Record Event'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
```

### 4.2 Sidebar Configuration
**File:** `src/sidebarConfig.ts`

Add new sidebar items under the Inventory section:
```typescript
{
  key: 'inventory',
  label: 'Inventory',
  icon: ICONS.Products,
  children: [
    {
      key: 'products',
      label: 'Products',
      to: '/products',
      icon: ICONS.Products,
      visible: ({ can, hasCapability }) => can('products.view') && hasCapability('inventory'),
    },
    {
      key: 'batches',
      label: 'Batches',
      to: '/batches',
      icon: ICONS.Layers, // or a new batch-specific icon
      visible: ({ can, hasCapability }) => can('batches.view') && hasCapability('batch_management'),
    },
    {
      key: 'batch_event_history',
      label: 'Batch Event History',
      to: '/batch-event-history',
      icon: ICONS.Clock,
      visible: ({ can, hasCapability }) => can('batch_events.view') && hasCapability('batch_management'),
    },
  ],
},
```

### 4.3 Route Configuration
**File:** `App.tsx`

Add new lazy-loaded components:
```typescript
const Batches = lazyPage(() => import('./pages/Batches'));
const BatchForm = lazyPage(() => import('./pages/BatchForm'));
const BatchEventHistory = lazyPage(() => import('./pages/BatchEventHistory'));
```

Add new routes:
```typescript
// Batch routes
<Route path="/batches" element={
  isAuthenticated ? (can('batches.view') && hasCapability('batch_management') ? <Layout><Batches /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
} />
<Route path="/batches/new" element={
  isAuthenticated ? (can('batches.create') && hasCapability('batch_management') ? (writeDisabled ? <Navigate to="/batches" replace /> : <Layout><BatchForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
} />
<Route path="/batches/edit/:id" element={
  isAuthenticated ? (can('batches.edit') && hasCapability('batch_management') ? (writeDisabled ? <Navigate to="/batches" replace /> : <Layout><BatchForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
} />
<Route path="/batch-event-history" element={
  isAuthenticated ? (can('batch_events.view') && hasCapability('batch_management') ? <Layout><BatchEventHistory /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
} />
```

### 4.4 Page Headers
**File:** `components/Layout.tsx`

Add to the `pageHeader` memo (around line 162):
```typescript
if (pathname.startsWith('/batches/new')) {
  return { title: 'New Batch', subtitle: 'Create a new batch of living products.' };
}
if (pathname.startsWith('/batches/edit/')) {
  return { title: 'Edit Batch', subtitle: 'Update the selected batch details.' };
}
if (pathname.startsWith('/batches')) {
  return { title: 'Batches', subtitle: 'Manage batches of living products with population tracking.' };
}
if (pathname.startsWith('/batch-event-history')) {
  return { title: 'Batch Event History', subtitle: 'Review all recorded events for living product batches.' };
}
```

---

## 5. API Endpoints

### 5.1 Backend API Actions
**File:** `backend/public/index.php`

Add new action handlers after existing actions:
```php
// Batch Management Actions
if ($action === 'fetchBatchesPage') {
    Http::ok($operations->fetchBatchesPage($payload));
    exit;
}
if ($action === 'fetchBatchById') {
    Http::ok($operations->fetchBatchById($payload));
    exit;
}
if ($action === 'createBatch') {
    Http::ok($operations->createBatch($payload));
    exit;
}
if ($action === 'updateBatch') {
    Http::ok($operations->updateBatch($payload));
    exit;
}
if ($action === 'deleteBatch') {
    Http::ok($operations->deleteBatch($payload));
    exit;
}
if ($action === 'fetchBatchCategories') {
    Http::ok($operations->fetchBatchCategories($payload));
    exit;
}
if ($action === 'createBatchCategory') {
    Http::ok($operations->createBatchCategory($payload));
    exit;
}
if ($action === 'updateBatchCategory') {
    Http::ok($operations->updateBatchCategory($payload));
    exit;
}
if ($action === 'deleteBatchCategory') {
    Http::ok($operations->deleteBatchCategory($payload));
    exit;
}
if ($action === 'fetchBatchEventTypes') {
    Http::ok($operations->fetchBatchEventTypes($payload));
    exit;
}
if ($action === 'fetchBatchEventsPage') {
    Http::ok($operations->fetchBatchEventsPage($payload));
    exit;
}
if ($action === 'createBatchEvent') {
    Http::ok($operations->createBatchEvent($payload));
    exit;
}
if ($action === 'deleteBatchEvent') {
    Http::ok($operations->deleteBatchEvent($payload));
    exit;
}
```

### 5.2 Operations API Methods
**File:** `backend/src/OperationsApi.php`

Add all the batch-related methods. See Section 2.2 for the complete method implementations including:
- `fetchBatchesPage()` - Paginated batch list
- `fetchBatchById()` - Single batch details
- `createBatch()` - Create new batch
- `updateBatch()` - Update batch details
- `deleteBatch()` - Soft delete batch
- `fetchBatchCategories()` - List all batch categories
- `createBatchCategory()` - Create new category
- `updateBatchCategory()` - Update category
- `deleteBatchCategory()` - Soft delete category
- `fetchBatchEventTypes()` - List all event types
- `fetchBatchEventsPage()` - Paginated event list
- `createBatchEvent()` - Record new event with automatic transaction/stock adjustment creation
- `deleteBatchEvent()` - Delete event with population reversion

---

## 6. React Query Hooks

### 6.1 Query Hooks
**File:** `src/hooks/useQueries.ts`

Add new query hooks:
```typescript
// Batch queries
export function useBatchesPage(
  page: number,
  pageSize: number,
  searchQuery?: string,
  categoryId?: string
): UseQueryResult<{ data: Batch[]; count: number }> {
  return useQuery({
    queryKey: ['batches', page, pageSize, searchQuery, categoryId],
    queryFn: () => fetchBatchesPage(page, pageSize, searchQuery, categoryId),
  });
}

export function useBatch(id: string | undefined): UseQueryResult<Batch | null> {
  return useQuery({
    queryKey: ['batch', id],
    queryFn: () => (id ? fetchBatchById(id) : Promise.resolve(null)),
    enabled: !!id,
  });
}

export function useBatchCategories(): UseQueryResult<BatchCategory[]> {
  return useQuery({
    queryKey: ['batch-categories'],
    queryFn: fetchBatchCategories,
  });
}

export function useBatchEventTypes(): UseQueryResult<BatchEventType[]> {
  return useQuery({
    queryKey: ['batch-event-types'],
    queryFn: fetchBatchEventTypes,
  });
}

export function useBatchEventsPage(
  page: number,
  pageSize: number,
  filters?: {
    batchId?: string;
    eventTypeId?: string;
    dateFrom?: string;
    dateTo?: string;
  }
): UseQueryResult<{ data: BatchEvent[]; count: number }> {
  return useQuery({
    queryKey: ['batch-events', page, pageSize, filters],
    queryFn: () => fetchBatchEventsPage(page, pageSize, filters),
  });
}
```

### 6.2 Mutation Hooks
**File:** `src/hooks/useMutations.ts`

Add new mutation hooks:
```typescript
// Batch mutations
export function useCreateBatch(): UseMutationResult<{ id: string }, Error, Omit<Batch, 'id' | 'createdAt' | 'updatedAt' | 'categoryName'>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchData) => apiAction<{ id: string }>('createBatch', batchData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['batch-categories'] });
    },
  });
}

export function useUpdateBatch(): UseMutationResult<{ success: boolean }, Error, { id: string; updates: Partial<Batch> }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => apiAction<{ success: boolean }>('updateBatch', { id, ...updates }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['batch', id] });
    },
  });
}

export function useDeleteBatch(): UseMutationResult<{ success: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiAction<{ success: boolean }>('deleteBatch', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
    },
  });
}

// Batch category mutations
export function useCreateBatchCategory(): UseMutationResult<{ id: string }, Error, Omit<BatchCategory, 'id' | 'createdAt' | 'updatedAt'>> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryData) => apiAction<{ id: string }>('createBatchCategory', categoryData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-categories'] });
    },
  });
}

export function useUpdateBatchCategory(): UseMutationResult<{ success: boolean }, Error, { id: string; updates: Partial<BatchCategory> }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => apiAction<{ success: boolean }>('updateBatchCategory', { id, ...updates }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-categories'] });
    },
  });
}

export function useDeleteBatchCategory(): UseMutationResult<{ success: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiAction<{ success: boolean }>('deleteBatchCategory', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batch-categories'] });
      queryClient.invalidateQueries({ queryKey: ['batches'] });
    },
  });
}

// Batch event mutations
export function useCreateBatchEvent(): UseMutationResult<{ id: string; success: boolean; newPopulation: number }, Error, BatchEventInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventData) => apiAction<{ id: string; success: boolean; newPopulation: number }>('createBatchEvent', eventData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['batch-events'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export function useDeleteBatchEvent(): UseMutationResult<{ success: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiAction<{ success: boolean }>('deleteBatchEvent', { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['batch-events'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
```

### 6.3 Supabase Query Functions
**File:** `src/services/supabaseQueries.ts`

Add new fetch functions:
```typescript
// Batch queries
export async function fetchBatchesPage(page: number, pageSize: number, searchQuery?: string, categoryId?: string): Promise<{ data: Batch[]; count: number }> {
  const supabase = createClient();
  
  let query = supabase
    .from('batches')
    .select('*, batch_categories(name) as category_name, users(name) as created_by_name', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  
  if (searchQuery) {
    query = query.or(`name.ilike.%${searchQuery}%,sku.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
  }
  
  if (categoryId) {
    query = query.eq('category_id', categoryId);
  }
  
  const { data, count, error } = await query
    .range((page - 1) * pageSize, page * pageSize - 1);
  
  if (error) throw error;
  
  return { data: data || [], count: count || 0 };
}

export async function fetchBatchById(id: string): Promise<Batch | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('batches')
    .select('*, batch_categories(name) as category_name')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data as Batch | null;
}

export async function fetchBatchCategories(): Promise<BatchCategory[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('batch_categories')
    .select('*')
    .is('deleted_at', null)
    .order('name', { ascending: true });
  
  if (error) throw error;
  return data as BatchCategory[];
}

export async function fetchBatchEventTypes(): Promise<BatchEventType[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('batch_event_types')
    .select('*')
    .order('name', { ascending: true });
  
  if (error) throw error;
  return data as BatchEventType[];
}

export async function fetchBatchEventsPage(
  page: number,
  pageSize: number,
  filters?: { batchId?: string; eventTypeId?: string; dateFrom?: string; dateTo?: string }
): Promise<{ data: BatchEvent[]; count: number }> {
  const supabase = createClient();
  
  let query = supabase
    .from('batch_events')
    .select(`*, 
      batch_event_types(name) as event_type_name, 
      batches(name) as batch_name, 
      users(name) as created_by_name,
      accounts(name) as account_name,
      payment_methods(name) as payment_method_name`, { count: 'exact' })
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false });
  
  if (filters?.batchId) {
    query = query.eq('batch_id', filters.batchId);
  }
  
  if (filters?.eventTypeId) {
    query = query.eq('event_type_id', filters.eventTypeId);
  }
  
  if (filters?.dateFrom) {
    query = query.gte('event_date', filters.dateFrom);
  }
  
  if (filters?.dateTo) {
    query = query.lte('event_date', filters.dateTo);
  }
  
  const { data, count, error } = await query
    .range((page - 1) * pageSize, page * pageSize - 1);
  
  if (error) throw error;
  
  return { data: data || [], count: count || 0 };
}
```

---

## 7. OrderForm and BillForm Integration

### 7.1 Product Selection Enhancement
**Files:** `pages/OrderForm.tsx` and `pages/BillForm.tsx`

Add batch selection alongside products:

```typescript
// Add new state
const [showBatches, setShowBatches] = useState(false);
const { data: batches = [] } = useBatchesPage(1, 10000);

// Add toggle buttons
<div className="flex gap-2 mb-4">
  <button 
    className={`px-4 py-2 rounded-xl text-sm font-bold ${!showBatches ? 'bg-[#3c5a82] text-white' : 'bg-gray-100 text-gray-600'}`}
    onClick={() => setShowBatches(false)}
  >
    Products
  </button>
  <button 
    className={`px-4 py-2 rounded-xl text-sm font-bold ${showBatches ? 'bg-[#3c5a82] text-white' : 'bg-gray-100 text-gray-600'}`}
    onClick={() => setShowBatches(true)}
  >
    Batches
  </button>
</div>

// Modify item selection
{showBatches ? (
  <div className="space-y-2 max-h-60 overflow-y-auto">
    {batches.map((batch) => (
      <button
        key={batch.id}
        onClick={() => {
          const newItem: OrderItem = {
            productId: `batch-${batch.id}`,
            productName: `[Batch] ${batch.name}`,
            rate: batch.salePrice,
            quantity: 1,
            amount: batch.salePrice,
          };
          addItem(newItem);
        }}
        className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl w-full text-left"
      >
        <img src={batch.image} className="w-10 h-10 rounded-lg object-cover" />
        <div className="flex-1">
          <p className="font-bold">{batch.name}</p>
          <p className="text-sm text-gray-500">
            Population: {batch.population} | Age: {formatAge(batch.averageAgeDays)} | ৳{batch.salePrice}/unit
          </p>
        </div>
      </button>
    ))}
  </div>
) : (
  // Existing product selection
  <div className="space-y-2 max-h-60 overflow-y-auto">
    {products.map((product) => (
      // ... existing product rendering
    ))}
  </div>
)}
```

### 7.2 Order Processing with Batches
When an order containing batch items is completed:
- Extract batch ID from productId (`batch-{id}`)
- Reduce batch population by the quantity sold
- Create stock adjustment record
- Create transaction if applicable

---

## 8. Settings Page Integration

### 8.1 Batch Categories Tab
**File:** `pages/Settings.tsx`

Add new tab for batch categories management:

```typescript
// Add to tab list
const tabs = [
  { key: 'company', label: 'Company', icon: ICONS.Building },
  { key: 'order-invoice', label: 'Order & Invoice', icon: ICONS.FileText },
  { key: 'defaults', label: 'Defaults', icon: ICONS.Settings },
  { key: 'categories', label: 'Categories', icon: ICONS.Layers },
  { key: 'batch-categories', label: 'Batch Categories', icon: ICONS.Layers }, // NEW
  // ... rest
];

// Add tab content
{activeTab === 'batch-categories' && (
  <BatchCategoriesSettingsPanel
    categories={batchCategories}
    onCreate={createBatchCategoryMutation.mutateAsync}
    onUpdate={updateBatchCategoryMutation.mutateAsync}
    onDelete={deleteBatchCategoryMutation.mutateAsync}
    canEdit={canEditCategories}
  />
)}
```

### 8.2 BatchCategoriesSettingsPanel Component
**File:** `components/BatchCategoriesSettingsPanel.tsx`

Create new component similar to existing category management:
- List all batch categories in a table
- Add new category form with name, description, color picker
- Edit category modal
- Delete category with confirmation (prevent system category deletion)
- Drag-and-drop reordering (optional)

---

## 9. Utility Functions

### 9.1 Age Conversion Utilities
**File:** `src/utils/batchUtils.ts` (New file)

```typescript
/**
 * Age components for display
 */
export interface AgeComponents {
  years: number;
  months: number;
  days: number;
}

/**
 * Convert age components to total days
 * Used for storing age efficiently in database
 */
export function ageToDays(age: AgeComponents): number {
  return age.years * 365 + age.months * 30 + age.days;
}

/**
 * Convert total days to age components
 * Used for displaying age to users
 */
export function daysToAge(days: number): AgeComponents {
  const years = Math.floor(days / 365);
  const remainingDays = days % 365;
  const months = Math.floor(remainingDays / 30);
  const daysRemaining = remainingDays % 30;
  
  return { years, months, days: daysRemaining };
}

/**
 * Format age for display
 * Example: "2 years, 3 months, 5 days" or "15 days"
 */
export function formatAge(days: number): string {
  const { years, months, days: daysPart } = daysToAge(days);
  const parts = [];
  
  if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
  if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
  if (daysPart > 0 || parts.length === 0) parts.push(`${daysPart} day${daysPart !== 1 ? 's' : ''}`);
  
  return parts.join(', ');
}

/**
 * Check if a product ID represents a batch
 */
export function isBatchId(productId: string): boolean {
  return productId.startsWith('batch-');
}

/**
 * Extract batch ID from prefixed product ID
 */
export function extractBatchId(productId: string): string | null {
  if (isBatchId(productId)) {
    return productId.substring(6); // Remove 'batch-' prefix
  }
  return null;
}

/**
 * Get display name for batch items in orders
 */
export function getBatchDisplayName(batch: Batch): string {
  return `[Batch] ${batch.name}`;
}
```

---

## 10. Permission Definitions

### 10.1 Permission Definitions
**File:** `src/utils/permissions.ts`

Add new permission definitions to the `PERMISSION_DEFINITIONS` array:

```typescript
export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // ... existing permissions
  
  // Batch Management Permissions
  {
    key: 'batches.view',
    label: 'View Batches',
    description: 'View the list of living product batches',
    section: 'Inventory',
  },
  {
    key: 'batches.create',
    label: 'Create Batches',
    description: 'Create new batches of living products',
    section: 'Inventory',
  },
  {
    key: 'batches.edit',
    label: 'Edit Batches',
    description: 'Edit existing batch details including name, category, pricing, and description',
    section: 'Inventory',
  },
  {
    key: 'batches.delete',
    label: 'Delete Batches',
    description: 'Delete batches (moves to recycle bin)',
    section: 'Inventory',
  },
  {
    key: 'batch_events.view',
    label: 'View Batch Events',
    description: 'View the history of events recorded for batches',
    section: 'Inventory',
  },
  {
    key: 'batch_events.create',
    label: 'Create Batch Events',
    description: 'Record events for batches such as deaths, vaccinations, illnesses, etc.',
    section: 'Inventory',
  },
  {
    key: 'batch_events.delete',
    label: 'Delete Batch Events',
    description: 'Delete batch event records (with population reversion)',
    section: 'Inventory',
  },
];
```

### 10.2 Default Role Permissions
**File:** `src/utils/permissions.ts`

Update `DEFAULT_ROLE_PERMISSION_SETTINGS`:

```typescript
export const DEFAULT_ROLE_PERMISSION_SETTINGS: Record<UserRole, RolePermissionMap> = {
  Admin: {
    // ... existing permissions
    'batches.view': true,
    'batches.create': true,
    'batches.edit': true,
    'batches.delete': true,
    'batch_events.view': true,
    'batch_events.create': true,
    'batch_events.delete': true,
    // ...
  },
  Developer: {
    // All permissions true
    'batches.view': true,
    'batches.create': true,
    'batches.edit': true,
    'batches.delete': true,
    'batch_events.view': true,
    'batch_events.create': true,
    'batch_events.delete': true,
    // ...
  },
  Employee: {
    // ... existing permissions
    'batches.view': true,
    'batches.create': false,
    'batches.edit': false,
    'batches.delete': false,
    'batch_events.view': true,
    'batch_events.create': true,
    'batch_events.delete': false,
    // ...
  },
};
```

---

## 11. Recycle Bin Integration

### 11.1 Type Update
**File:** `types.ts`

Already added `'batch'` to `RecycleBinEntityType` in Section 3.1.

### 11.2 Recycle Bin Query Update
**File:** `src/services/supabaseQueries.ts`

Update `fetchRecycleBinPage` to include batches:

```typescript
export async function fetchRecycleBinPage(
  page: number,
  pageSize: number,
  entityType?: RecycleBinEntityType
): Promise<RecycleBinPage> {
  const items: RecycleBinItem[] = [];
  
  // ... existing entity type handling
  
  // Add batch handling
  if (!entityType || entityType === 'batch') {
    const { data: deletedBatches, count: batchCount } = await supabase
      .from('batches')
      .select('id, name, population, deleted_at, deleted_by, users(name) as deleted_by_name')
      .is('deleted_at', 'not.is', null)
      .order('deleted_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    
    if (deletedBatches) {
      items.push(...deletedBatches.map(b => ({
        id: b.id,
        entityType: 'batch' as const,
        title: b.name,
        description: `Population: ${b.population}`,
        details: [],
        deletedAt: b.deleted_at,
        deletedBy: b.deleted_by,
        deletedByName: b.deleted_by_name?.name,
      })));
    }
  }
  
  // ... rest of function
}
```

---

## 12. Implementation Checklist

### Phase 1: Backend Setup (Priority: High)
- [ ] Add database tables to `backend/schema-only.sql`
- [ ] Create `backend/bin/setup_batch_event_types.php` for system data
- [ ] Add API action handlers in `backend/public/index.php`
- [ ] Implement all OperationsApi methods in `backend/src/OperationsApi.php`
- [ ] Run database migrations
- [ ] Run system data initialization script

### Phase 2: Type System (Priority: High)
- [ ] Add Batch, BatchCategory, BatchEvent, BatchEventType interfaces to `types.ts`
- [ ] Add permission keys to `PermissionKey` type
- [ ] Add `batch_management` to `AppCapabilityKey` type
- [ ] Update `RecycleBinEntityType` to include `'batch'`

### Phase 3: Capability System (Priority: High)
- [ ] Add capability labels and descriptions to `src/utils/capabilities.ts`
- [ ] Add capability to `DEFAULT_CAPABILITIES`
- [ ] Add route-capability rule to `ROUTE_CAPABILITY_RULES`

### Phase 4: Frontend Infrastructure (Priority: High)
- [ ] Add routes to `App.tsx`
- [ ] Add sidebar items to `src/sidebarConfig.ts`
- [ ] Add page headers to `components/Layout.tsx`
- [ ] Add new icon to `constants.ts`

### Phase 5: Data Layer (Priority: High)
- [ ] Add React Query hooks to `src/hooks/useQueries.ts`
- [ ] Add mutation hooks to `src/hooks/useMutations.ts`
- [ ] Add supabase query functions to `src/services/supabaseQueries.ts`
- [ ] Create utility functions in `src/utils/batchUtils.ts`

### Phase 6: UI Components (Priority: Medium)
- [ ] Create `pages/Batches.tsx`
- [ ] Create `pages/BatchForm.tsx`
- [ ] Create `pages/BatchEventHistory.tsx`
- [ ] Create `components/BatchEventModal.tsx`
- [ ] Create `components/BatchCategoriesSettingsPanel.tsx`

### Phase 7: Integration (Priority: Medium)
- [ ] Update `pages/OrderForm.tsx` for batch selection
- [ ] Update `pages/BillForm.tsx` for batch selection
- [ ] Add batch categories tab to `pages/Settings.tsx`
- [ ] Update permission definitions in `src/utils/permissions.ts`
- [ ] Update default role permissions
- [ ] Update recycle bin queries

### Phase 8: Testing (Priority: Low)
- [ ] Test batch CRUD operations
- [ ] Test event recording with population changes
- [ ] Test transaction creation for financial events
- [ ] Test batch selection in orders/bills
- [ ] Test permission enforcement
- [ ] Test capability gating
- [ ] Test recycle bin integration

---

## 13. File Modifications Summary

### New Files to Create (11 files):
1. `pages/Batches.tsx` - Main batches listing page
2. `pages/BatchForm.tsx` - Create/edit batch form
3. `pages/BatchEventHistory.tsx` - Batch event history page
4. `components/BatchEventModal.tsx` - Modal for recording events
5. `components/BatchCategoriesSettingsPanel.tsx` - Batch categories management in settings
6. `src/utils/batchUtils.ts` - Age conversion and batch utilities
7. `backend/bin/setup_batch_event_types.php` - System data initialization

### Files to Modify (15 files):
1. `types.ts` - Add new types and permission keys
2. `src/utils/capabilities.ts` - Add new capability configuration
3. `App.tsx` - Add new routes
4. `components/Layout.tsx` - Add page headers for batch pages
5. `constants.ts` - Add new icons if needed
6. `src/sidebarConfig.ts` - Add sidebar navigation items
7. `src/hooks/useQueries.ts` - Add query hooks
8. `src/hooks/useMutations.ts` - Add mutation hooks
9. `src/services/supabaseQueries.ts` - Add fetch functions
10. `pages/Settings.tsx` - Add batch categories tab
11. `src/utils/permissions.ts` - Add permission definitions and defaults
12. `pages/OrderForm.tsx` - Add batch selection
13. `pages/BillForm.tsx` - Add batch selection
14. `backend/public/index.php` - Add API action handlers
15. `backend/src/OperationsApi.php` - Add backend methods
16. `backend/schema-only.sql` - Add database schema

---

## 14. Verification Plan

### 14.1 Manual Testing Checklist

#### Capability Testing
- [ ] Enable `batch_management` capability in developer settings
- [ ] Verify "Batches" and "Batch Event History" appear in sidebar
- [ ] Verify accessing `/batches` without capability redirects to default route
- [ ] Disable capability and verify access is blocked

#### Batch CRUD Testing
- [ ] Create a new batch with all fields (name, category, population, age, prices)
- [ ] Verify batch appears in list with correct population display
- [ ] Edit batch details (name, description, pricing)
- [ ] Verify changes persist
- [ ] Delete batch and verify it moves to recycle bin
- [ ] Verify batch can be restored from recycle bin

#### Event Recording Testing
- [ ] Create a batch with population 50
- [ ] Open "Mark Event" modal
- [ ] Select "Death" event type
- [ ] Enter population change of 5
- [ ] Record event
- [ ] Verify batch population updates to 45
- [ ] Verify event appears in Batch Event History
- [ ] Create "Vaccination" event with expense amount
- [ ] Verify transaction is created in transactions list
- [ ] Verify stock adjustment record created

#### Order Integration Testing
- [ ] Create an order
- [ ] Switch to "Batches" tab in product selection
- [ ] Add a batch item to order
- [ ] Verify batch item appears in order with correct pricing
- [ ] Complete order
- [ ] Verify batch population decreases by quantity sold

#### Permission Testing
- [ ] Log in as Employee
- [ ] Verify can view batches list
- [ ] Verify cannot create new batch
- [ ] Verify cannot edit existing batch
- [ ] Verify can record events
- [ ] Verify cannot delete events
- [ ] Log in as Admin
- [ ] Verify all batch operations are available

### 14.2 Automated Testing (Optional)

Consider adding:
- API endpoint tests for batch operations
- Component tests for BatchForm validation
- Integration tests for event recording flow
- Permission enforcement tests

---

## 15. Notes and Considerations

### 15.1 Design Decisions

1. **Capability Name**: Chose `batch_management` to clearly distinguish from `inventory` (products)

2. **Population vs Quantity**: Use "population" terminology throughout to emphasize living individuals vs. identical copies

3. **Age Storage**: Store age as total days for database efficiency, convert to years/months/days for display

4. **Pricing**: Sale and purchase prices are per individual, not per batch (consistent with product pricing model)

5. **Event Types**: System event types are created on first run and marked as undeletable to ensure data consistency

6. **Stock Adjustments**: Events create optional stock adjustment records for audit trail, separate from population tracking

7. **Transactions**: Financial events automatically create expense transactions for proper accounting

8. **Batch ID Prefix**: Use `batch-{id}` prefix for batch items in orders to distinguish from regular products

### 15.2 Future Enhancements

Potential future improvements not included in this plan:
- Batch-specific reports (mortality rate, growth rate, etc.)
- Batch health tracking dashboard
- Automated event reminders (vaccination schedules)
- Batch genealogy/lineage tracking
- Integration with veterinary management systems
- Mobile app support for event recording in the field
- Bulk event recording (record same event for multiple batches)
- Event templates for common scenarios

### 15.3 Dependencies

This implementation depends on:
- Existing capability system
- Existing permission system
- Existing React Query setup
- Existing Supabase client configuration
- Existing sidebar configuration system
- Existing recycle bin system

All of these are already present in the codebase.

---

## Document Information

**Created:** 2026-08-11  
**Version:** 1.0  
**Status:** Draft - Awaiting Approval  
**Author:** Claude Code (with user requirements)
