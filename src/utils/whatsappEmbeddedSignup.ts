export const DEFAULT_WHATSAPP_GRAPH_VERSION = 'v26.0';

export const buildWhatsAppBusinessAppOnboardingOptions = (configurationId: string) => ({
  config_id: configurationId,
  response_type: 'code' as const,
  override_default_response_type: true,
  extras: {
    setup: {},
    featureType: 'whatsapp_business_app_onboarding' as const,
    sessionInfoVersion: '3' as const,
  },
});
