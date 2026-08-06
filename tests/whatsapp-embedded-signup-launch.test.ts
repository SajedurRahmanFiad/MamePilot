import assert from 'node:assert/strict';

import {
  buildWhatsAppBusinessAppOnboardingOptions,
  DEFAULT_WHATSAPP_GRAPH_VERSION,
} from '../src/utils/whatsappEmbeddedSignup.ts';

assert.equal(DEFAULT_WHATSAPP_GRAPH_VERSION, 'v26.0');
assert.deepEqual(
  buildWhatsAppBusinessAppOnboardingOptions('123456789012345'),
  {
    config_id: '123456789012345',
    response_type: 'code',
    override_default_response_type: true,
    extras: {
      setup: {},
      featureType: 'whatsapp_business_app_onboarding',
      sessionInfoVersion: '3',
    },
  },
  'WhatsApp Business app Coexistence must not fall back to generic business asset login.',
);

console.log('WhatsApp Embedded Signup launch assertions passed.');
