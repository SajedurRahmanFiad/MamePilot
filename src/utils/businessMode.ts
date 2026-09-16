import type { BusinessMode } from '../../types';

export const isVaccineCenterMode = (businessMode?: BusinessMode | null): boolean => businessMode === 'vaccine_center';

export const getBusinessTerminology = (businessMode?: BusinessMode | null) => {
  const vaccineCenter = isVaccineCenterMode(businessMode);
  return {
    item: vaccineCenter ? 'Vaccine' : 'Product',
    items: vaccineCenter ? 'Vaccines' : 'Products',
    itemLower: vaccineCenter ? 'vaccine' : 'product',
    itemsLower: vaccineCenter ? 'vaccines' : 'products',
    customer: vaccineCenter ? 'Patient' : 'Customer',
    customers: vaccineCenter ? 'Patients' : 'Customers',
    customerLower: vaccineCenter ? 'patient' : 'customer',
    customersLower: vaccineCenter ? 'patients' : 'customers',
  };
};