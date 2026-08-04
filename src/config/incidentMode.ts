export const WRITE_FREEZE_ENABLED = false;

export const WRITE_FREEZE_TITLE =
  (import.meta.env.VITE_DB_WRITE_FREEZE_TITLE as string | undefined)?.trim() ||
  'Read-only incident mode';

export const WRITE_FREEZE_MESSAGE =
  (import.meta.env.VITE_DB_WRITE_FREEZE_MESSAGE as string | undefined)?.trim() ||
  'Database writes are temporarily disabled for maintenance. You can keep using the app in read-only mode.';

export function getWriteFreezeErrorMessage(action: string): string {
  const safeAction = action.trim() || 'This action';
  return `${safeAction} is temporarily disabled. ${WRITE_FREEZE_MESSAGE}`;
}
