import type { CompanyPage, CompanySettings, Order } from '../../types';

const DEFAULT_COMPANY_NAME = 'Mame Pilot';
const DEFAULT_COMPANY_LOGO = '/uploads/Avatar.png';
const DEFAULT_COMPANY_PHONE = '+880';
const DEFAULT_COMPANY_EMAIL = 'info@company.com';
const DEFAULT_PAGE_ID = 'company-default-page';

type PartialCompanyPage = Partial<CompanyPage> | null | undefined;
type PartialCompanySettings = Partial<CompanySettings> | null | undefined;

export function normalizeCompanyPage(
  page: PartialCompanyPage,
  index: number = 0,
  fallback: Partial<CompanyPage> = {},
): CompanyPage {
  const fallbackName = String(fallback.name || '').trim() || (index === 0 ? DEFAULT_COMPANY_NAME : `Page ${index + 1}`);
  // Don't trim user-provided names - preserve their input as-is, only trim fallback values
  const name = (page?.name !== undefined && page?.name !== null) ? String(page.name) : (String(fallback.name || '').trim() || fallbackName);
  const id = String(page?.id || fallback.id || '').trim() || (index === 0 ? DEFAULT_PAGE_ID : `company-page-${index + 1}`);

  return {
    id,
    name,
    logo: String(page?.logo || fallback.logo || (index === 0 ? DEFAULT_COMPANY_LOGO : '')),
    phone: String(page?.phone || fallback.phone || DEFAULT_COMPANY_PHONE),
    email: String(page?.email || fallback.email || DEFAULT_COMPANY_EMAIL),
    address: String(page?.address || fallback.address || ''),
    isGlobalBranding: Boolean(page?.isGlobalBranding ?? fallback.isGlobalBranding ?? false),
  };
}

export function normalizeCompanySettings(settings: PartialCompanySettings): CompanySettings {
  const rawPages = Array.isArray(settings?.pages) ? settings.pages : [];
  const fallbackPage = normalizeCompanyPage(
    {
      id: settings?.id || DEFAULT_PAGE_ID,
      name: settings?.name,
      logo: settings?.logo,
      phone: settings?.phone,
      email: settings?.email,
      address: settings?.address,
      isGlobalBranding: true,
    },
    0,
  );

  const pages = (rawPages.length > 0 ? rawPages : [fallbackPage]).map((page, index) =>
    normalizeCompanyPage(page, index, index === 0 ? fallbackPage : {}),
  );

  let foundGlobal = false;
  const normalizedPages = pages.map((page) => {
    const isGlobalBranding = page.isGlobalBranding && !foundGlobal;
    if (isGlobalBranding) {
      foundGlobal = true;
    }

    return {
      ...page,
      isGlobalBranding,
    };
  });

  if (!foundGlobal && normalizedPages[0]) {
    normalizedPages[0] = {
      ...normalizedPages[0],
      isGlobalBranding: true,
    };
  }

  const globalPage = normalizedPages.find((page) => page.isGlobalBranding) || normalizedPages[0] || fallbackPage;

  return {
    id: String(settings?.id || 'company-default'),
    name: globalPage.name,
    logo: globalPage.logo,
    phone: globalPage.phone,
    email: globalPage.email,
    address: globalPage.address,
    pages: normalizedPages,
  };
}

export function getGlobalCompanyPage(settings: PartialCompanySettings): CompanyPage {
  const normalized = normalizeCompanySettings(settings);
  return normalized.pages.find((page) => page.isGlobalBranding) || normalized.pages[0];
}

export function buildOrderPageSnapshot(page: PartialCompanyPage): CompanyPage | null {
  if (!page) {
    return null;
  }

  return normalizeCompanyPage(page, 0);
}

export function getOrderCompanyPage(
  order: Partial<Order> | null | undefined,
  settings: PartialCompanySettings,
): CompanyPage {
  if (order?.pageSnapshot && Object.keys(order.pageSnapshot).length > 0) {
    return normalizeCompanyPage(order.pageSnapshot, 0);
  }

  const normalizedSettings = normalizeCompanySettings(settings);
  const matchedPage = normalizedSettings.pages.find((page) => page.id === order?.pageId);
  return matchedPage || getGlobalCompanyPage(normalizedSettings);
}
