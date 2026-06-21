import { isDeveloperRole, type AppCapabilityKey } from '../../types';
import { useAuth } from '../contexts/AuthProvider';
import { useCapabilitySettings } from './useQueries';
import { capabilityForPath, normalizeCapabilities } from '../utils/capabilities';

export function useCapabilities(enabled: boolean = true) {
  const { user, profile } = useAuth();
  const activeUser = profile || user;
  const isDeveloper = isDeveloperRole(activeUser?.role);
  const { data, isPending } = useCapabilitySettings(enabled && !!activeUser);
  const capabilities = normalizeCapabilities(data?.capabilities);

  const hasCapability = (key: AppCapabilityKey): boolean => {
    return isDeveloper || Boolean(capabilities[key]);
  };

  const canAccessPath = (pathname: string): boolean => {
    const capability = capabilityForPath(pathname);
    return capability === null || hasCapability(capability);
  };

  return {
    settings: data,
    capabilities,
    isLoading: isPending,
    isDeveloper,
    hasCapability,
    canAccessPath,
  };
}
