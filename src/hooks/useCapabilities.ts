import { isDeveloperRole, type AppCapabilityKey, type SubCapabilityKey } from '../../types';
import { useAuth } from '../contexts/AuthProvider';
import { useCapabilitySettings } from './useQueries';
import { capabilityForPath, normalizeCapabilities, normalizeSubCapabilities, resolveSubCapability, SUB_CAPABILITY_PARENT_MAP } from '../utils/capabilities';

export function useCapabilities(enabled: boolean = true) {
  const { user, profile } = useAuth();
  const activeUser = profile || user;
  const isDeveloper = isDeveloperRole(activeUser?.role);
  const { data, isPending } = useCapabilitySettings(enabled && !!activeUser);
  const capabilities = normalizeCapabilities(data?.capabilities);
  const rawSubs = (data?.capabilities as any)?.subCapabilities;
  const subCapabilities = normalizeSubCapabilities(rawSubs || {}, capabilities);

  const hasCapability = (key: AppCapabilityKey): boolean => {
    return isDeveloper || Boolean(capabilities[key]);
  };

  const hasSubCapability = (key: SubCapabilityKey): boolean => {
    if (isDeveloper) return true;
    return resolveSubCapability(key, capabilities, subCapabilities);
  };

  const canAccessPath = (pathname: string): boolean => {
    const capability = capabilityForPath(pathname);
    return capability === null || hasCapability(capability);
  };

  return {
    settings: data,
    capabilities,
    subCapabilities,
    isLoading: isPending,
    isDeveloper,
    hasCapability,
    hasSubCapability,
    canAccessPath,
  };
}
