<?php

declare(strict_types=1);

function contactModalAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$modal = (string) file_get_contents($root . '/components/ContactCreateModal.tsx');
$layout = (string) file_get_contents($root . '/components/Layout.tsx');
$app = (string) file_get_contents($root . '/App.tsx');
$customers = (string) file_get_contents($root . '/pages/Customers.tsx');
$vendors = (string) file_get_contents($root . '/pages/Vendors.tsx');
$orderForm = (string) file_get_contents($root . '/pages/OrderForm.tsx');
$billForm = (string) file_get_contents($root . '/pages/BillForm.tsx');
$mutations = (string) file_get_contents($root . '/src/hooks/useMutations.ts');

contactModalAssert(
    str_contains($modal, "type ContactKind = 'customer' | 'vendor'")
        && str_contains($modal, "const nameLabel = isCustomer ? 'Full Name' : 'Business Name'")
        && str_contains($modal, '>Phone Number</label>')
        && str_contains($modal, '>Address</label>')
        && str_contains($modal, 'useCreateCustomer()')
        && str_contains($modal, 'useCreateVendor()'),
    'The shared contact modal must create both customers and vendors with name, phone, and address fields.',
);

contactModalAssert(
    str_contains($modal, 'smartCustomerAdding')
        && str_contains($modal, 'smartVendorAdding')
        && str_contains($modal, "Phone number must be 11 digits and start with 0"),
    'The modal must preserve the existing Be Smart and phone-validation behavior.',
);

contactModalAssert(
    str_contains($layout, "onClick: () => setIsCustomerCreateOpen(true)")
        && str_contains($layout, "onClick: () => setIsVendorCreateOpen(true)")
        && !str_contains($layout, "label: 'New Customer', to: '/customers/new'")
        && !str_contains($layout, "label: 'New Vendor', to: '/vendors/new'"),
    'Header quick actions must open contact modals instead of navigating to add pages.',
);

contactModalAssert(
    str_contains($customers, 'onClick={handleOpenCreateCustomer}')
        && str_contains($customers, 'isCreateCustomerOpen && <CustomerCreateModal isOpen')
        && str_contains($vendors, 'onClick={handleOpenCreateVendor}')
        && str_contains($vendors, 'isCreateVendorOpen && <VendorCreateModal isOpen'),
    'Customer and vendor list actions must open their create modals in place.',
);

contactModalAssert(
    str_contains($app, 'state={{ openCreateCustomer: true }}')
        && str_contains($app, 'state={{ openCreateVendor: true }}')
        && substr_count($app, '<Layout><CustomerForm /></Layout>') === 1
        && substr_count($app, '<Layout><VendorForm /></Layout>') === 1,
    'Legacy contact add routes must redirect into modal state rather than rendering standalone add forms.',
);

contactModalAssert(
    !str_contains($orderForm, "navigate('/customers/new'")
        && str_contains($orderForm, 'onCreated={handleCustomerSelect}')
        && str_contains($orderForm, 'setCustomerId(customer.id)'),
    'Order creation must select the customer returned by the modal without leaving the form.',
);

contactModalAssert(
    !str_contains($billForm, "navigate('/vendors/new'")
        && str_contains($billForm, 'onCreated={(vendor) => {')
        && str_contains($billForm, 'setVendorId(vendor.id)')
        && str_contains($mutations, "queryClient.setQueryData(['vendor', data.id], data)"),
    'Bill creation must immediately select and hydrate the vendor returned by the modal.',
);

echo "Customer and vendor create-modal contracts passed.\n";
