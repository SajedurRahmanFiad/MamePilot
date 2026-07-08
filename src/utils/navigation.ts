import type { Location } from 'react-router-dom';

export type BackNavigationMode = 'history' | 'route';

export interface PreservedRouteState {
  from?: string;
  backMode?: BackNavigationMode;
  backLabel?: string;
  refreshOrdersOnBack?: boolean;
  refreshOrders?: boolean;
}

export const getCurrentRouteWithSearch = (
  location: Pick<Location, 'pathname' | 'search'>
): string => `${location.pathname}${location.search}`;

export const getPositivePageParam = (value: string | null | undefined, fallback = 1): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const getPreservedRouteState = (locationState: unknown): PreservedRouteState => {
  if (!locationState || typeof locationState !== 'object') {
    return {};
  }

  return locationState as PreservedRouteState;
};

export const buildHistoryBackState = (
  location: Pick<Location, 'pathname' | 'search'>,
  extraState: Omit<PreservedRouteState, 'from' | 'backMode'> = {}
): PreservedRouteState => ({
  from: getCurrentRouteWithSearch(location),
  backMode: 'history',
  ...extraState,
});
