import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useGlobalBranding, useSystemDefaults } from '../hooks/useQueries';
import type { SystemDefaultsSnapshot } from '../utils/startupCache';

export type BrandingMode = 'loading' | 'mamepilot' | 'white-label' | 'unavailable';

export type AppBranding = {
  mode: BrandingMode;
  name: string;
  logo: string;
  compactLogo: string;
  favicon: string;
};

const TRANSPARENT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E";

const LOADING_BRANDING: AppBranding = {
  mode: 'loading',
  name: '',
  logo: '',
  compactLogo: '',
  favicon: TRANSPARENT_ICON,
};

const UNAVAILABLE_BRANDING: AppBranding = {
  mode: 'unavailable',
  name: 'Management',
  logo: '',
  compactLogo: '',
  favicon: TRANSPARENT_ICON,
};

const MAMEPILOT_BRANDING: AppBranding = {
  mode: 'mamepilot',
  name: 'Mame Pilot',
  logo: '/uploads/Full Branding.png',
  compactLogo: '/uploads/Avatar.png',
  favicon: '/uploads/Avatar.png',
};

const BrandingContext = createContext<AppBranding>(LOADING_BRANDING);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    data: systemDefaults,
    dataUpdatedAt: systemDefaultsUpdatedAt,
    isSuccess: systemDefaultsQuerySucceeded,
    refetch: verifySystemDefaults,
  } = useSystemDefaults();
  const [verifiedSystemDefaults, setVerifiedSystemDefaults] = useState<SystemDefaultsSnapshot | null>(null);
  const [verifiedSystemDefaultsAt, setVerifiedSystemDefaultsAt] = useState(0);
  const [defaultsResolution, setDefaultsResolution] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const whiteLabelEnabled = defaultsResolution === 'ready' && Boolean(verifiedSystemDefaults?.whiteLabel);
  const {
    data: globalBranding,
    dataUpdatedAt: globalBrandingUpdatedAt,
    isSuccess: globalBrandingQuerySucceeded,
    refetch: verifyGlobalBranding,
  } = useGlobalBranding(whiteLabelEnabled);
  const [verifiedGlobalBranding, setVerifiedGlobalBranding] = useState<{ name: string; logo: string; version: string } | null>(null);
  const [verifiedGlobalBrandingAt, setVerifiedGlobalBrandingAt] = useState(0);
  const [globalBrandingResolution, setGlobalBrandingResolution] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    let active = true;
    setDefaultsResolution('loading');

    void verifySystemDefaults().then((result) => {
      if (!active) return;
      if (result.isSuccess && result.data) {
        setVerifiedSystemDefaults(result.data as SystemDefaultsSnapshot);
        setVerifiedSystemDefaultsAt(result.dataUpdatedAt);
        setDefaultsResolution('ready');
      } else {
        setDefaultsResolution('unavailable');
      }
    });

    return () => {
      active = false;
    };
  }, [verifySystemDefaults]);

  useEffect(() => {
    if (
      defaultsResolution === 'ready'
      && systemDefaultsQuerySucceeded
      && systemDefaults
      && systemDefaultsUpdatedAt > verifiedSystemDefaultsAt
    ) {
      setVerifiedSystemDefaults(systemDefaults as SystemDefaultsSnapshot);
      setVerifiedSystemDefaultsAt(systemDefaultsUpdatedAt);
    }
  }, [
    defaultsResolution,
    systemDefaults,
    systemDefaultsQuerySucceeded,
    systemDefaultsUpdatedAt,
    verifiedSystemDefaultsAt,
  ]);

  useEffect(() => {
    let active = true;

    if (!whiteLabelEnabled) {
      setGlobalBrandingResolution('loading');
      return () => {
        active = false;
      };
    }

    setGlobalBrandingResolution('loading');
    void verifyGlobalBranding().then((result) => {
      if (!active) return;
      if (result.isSuccess && result.data) {
        setVerifiedGlobalBranding(result.data);
        setVerifiedGlobalBrandingAt(result.dataUpdatedAt);
        setGlobalBrandingResolution('ready');
      } else {
        setGlobalBrandingResolution('unavailable');
      }
    });

    return () => {
      active = false;
    };
  }, [verifyGlobalBranding, whiteLabelEnabled]);

  useEffect(() => {
    if (
      globalBrandingResolution === 'ready'
      && globalBrandingQuerySucceeded
      && globalBranding
      && globalBrandingUpdatedAt > verifiedGlobalBrandingAt
    ) {
      setVerifiedGlobalBranding(globalBranding);
      setVerifiedGlobalBrandingAt(globalBrandingUpdatedAt);
    }
  }, [
    globalBranding,
    globalBrandingQuerySucceeded,
    globalBrandingResolution,
    globalBrandingUpdatedAt,
    verifiedGlobalBrandingAt,
  ]);

  const branding = useMemo<AppBranding>(() => {
    if (defaultsResolution === 'loading') {
      return LOADING_BRANDING;
    }

    if (defaultsResolution === 'unavailable') {
      return UNAVAILABLE_BRANDING;
    }

    if (!whiteLabelEnabled) {
      return MAMEPILOT_BRANDING;
    }

    if (globalBrandingResolution === 'loading') {
      return LOADING_BRANDING;
    }

    if (globalBrandingResolution === 'unavailable' || !verifiedGlobalBranding) {
      return UNAVAILABLE_BRANDING;
    }

    const name = verifiedGlobalBranding.name?.trim() || 'Management';
    const logo = verifiedGlobalBranding.logo?.trim() || '';
    return {
      mode: 'white-label',
      name,
      logo,
      compactLogo: logo,
      favicon: logo || TRANSPARENT_ICON,
    };
  }, [defaultsResolution, globalBrandingResolution, verifiedGlobalBranding, whiteLabelEnabled]);

  useEffect(() => {
    document.title = branding.mode === 'loading'
      ? 'Loading...'
      : `${branding.name || 'Management'} - Management`;

    try {
      const setLink = (rel: string) => {
        let element = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
        if (!element) {
          element = document.createElement('link');
          element.rel = rel;
          document.head.appendChild(element);
        }
        element.href = branding.favicon || TRANSPARENT_ICON;
      };

      setLink('icon');
      setLink('shortcut icon');
      setLink('apple-touch-icon');
    } catch (error) {
      console.warn('Failed to update app branding metadata:', error);
    }
  }, [branding.favicon, branding.mode, branding.name]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
};

export function useAppBranding(): AppBranding {
  return useContext(BrandingContext);
}
