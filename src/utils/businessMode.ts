import type { BusinessMode } from '../../types';

export const isVaccineCenterMode = (businessMode?: BusinessMode | null): boolean => businessMode === 'vaccine_center';

export const translateBusinessInventoryTerms = (text: string, businessMode?: BusinessMode | null): string => {
  if (businessMode !== 'sofa_cover') return text;
  return text.replace(/\b(products?|items?)\b/gi, (term) => {
    const fabric = term.toLowerCase().endsWith('s') ? 'fabrics' : 'fabric';
    if (term === term.toUpperCase()) return fabric.toUpperCase();
    return term[0] === term[0].toUpperCase() ? `${fabric[0].toUpperCase()}${fabric.slice(1)}` : fabric;
  });
};

export const getBusinessTerminology = (businessMode?: BusinessMode | null) => {
  const vaccineCenter = isVaccineCenterMode(businessMode);
  const sofaCover = businessMode === 'sofa_cover';
  return {
    item: vaccineCenter ? 'Vaccine' : sofaCover ? 'Fabric' : 'Product',
    items: vaccineCenter ? 'Vaccines' : sofaCover ? 'Fabrics' : 'Products',
    itemLower: vaccineCenter ? 'vaccine' : sofaCover ? 'fabric' : 'product',
    itemsLower: vaccineCenter ? 'vaccines' : sofaCover ? 'fabrics' : 'products',
    customer: vaccineCenter ? 'Patient' : 'Customer',
    customers: vaccineCenter ? 'Patients' : 'Customers',
    customerLower: vaccineCenter ? 'patient' : 'customer',
    customersLower: vaccineCenter ? 'patients' : 'customers',
  };
};