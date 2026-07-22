export const DEFAULT_MAINTENANCE_IMAGE_URL = '/uploads/Rat_avatar.png';
export const DEFAULT_MAINTENANCE_CAPTION = 'A mouse is stuck in your server';
export const DEFAULT_MAINTENANCE_SUBTITLE = 'Mame is actively chasing him with a piece of cheese to get it back to make the server work again.';
export const DEFAULT_MAINTENANCE_EXPLANATION = "Some new updates are in progress. For the sake of safety and security, the server is currently turned off. You'll be able to access the app again as soon as the update is complete.";

export const DEFAULT_MAINTENANCE_CONTENT = {
  imageUrl: DEFAULT_MAINTENANCE_IMAGE_URL,
  caption: DEFAULT_MAINTENANCE_CAPTION,
  subtitle: DEFAULT_MAINTENANCE_SUBTITLE,
  explanation: DEFAULT_MAINTENANCE_EXPLANATION,
} as const;
