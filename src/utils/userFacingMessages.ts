export const GENERIC_ACTION_ERROR = 'We could not complete this action. Please try again. If the problem continues, ask an administrator for help.';

const TECHNICAL_DETAIL_PATTERN = /(?:SQLSTATE|PDOException|TypeError|ReferenceError|SyntaxError|stack trace|\btrace\b|\bcurl\b|\bHTTP\s*\d{3}\b|\b(?:Graph|Cloud)?\s*API\b|\bwebhook\b|\bcallback\b|\bendpoint\b|\bdatabase\b|\bquery\b|\bpayload\b|access[_ -]?token|app[_ -]?secret|credentials?|unknown column|table .* doesn't exist|integrity constraint|foreign key constraint|rendered (?:more|fewer) hooks|unexpected token|json parse|\.php\(?\d+\)?|\.tsx?:\d+|node_modules|vendor[\\/]|[A-Za-z]:\\[^\s]+|\/home\/[^\s]+|\/var\/www\/[^\s]+)/i;
const OPAQUE_VALUE_PATTERN = /^(?:\[object Object\]|undefined|null|false|true|\{.*\}|\[.*\])$/i;

function removeStackAndPaths(value: string): string {
  let message = value.replace(/\u0000/g, '').trim();
  message = message.split(/\s+\[(?=(?:[A-Za-z]:\\|\/home\/|\/var\/www\/))/i)[0];
  message = message.split(/(?:\r?\n|\s+)#0\s+/)[0];
  message = message.split(/\s+\|\s+#0\s+/)[0];
  message = message.replace(/\s+at\s+(?:[A-Za-z]:\\|\/home\/|\/var\/www\/).*$/is, '');
  message = message.replace(/\s*\[(?:SQLSTATE|HTTP\s*\d+)[^\]]*\]\s*$/i, '');
  return message.replace(/\s+/g, ' ').trim();
}

export function userFacingErrorMessage(value: unknown, fallback: string = GENERIC_ACTION_ERROR): string {
  const original = typeof value === 'string'
    ? value
    : value instanceof Error
      ? value.message
      : '';
  let message = removeStackAndPaths(original);

  if (!message || OPAQUE_VALUE_PATTERN.test(message) || /^(?:unknown error|unknown action|missing action)\.?$/i.test(message) || /^request failed with status\s+\d+/i.test(message)) return fallback;
  if (/authentication required|session (?:has )?expired|invalid session/i.test(message)) return 'Your session has expired. Please sign in again.';
  if (/admin access required|developer access required|permission denied|not authorized|forbidden/i.test(message)) return 'You do not have permission to do this.';
  if (/request timed out|timeout|timed out/i.test(message)) return 'This is taking longer than expected. Please try again.';
  if (/network request failed|failed to fetch|networkerror|could not connect to server/i.test(message)) return 'Could not connect. Check your internet connection and try again.';
  if (/not configured|configuration (?:is )?required|credentials? (?:are|is) required|finish (?:the )?setup/i.test(message)) {
    return 'This service is not ready yet. Ask an administrator to finish the setup in Settings.';
  }

  if (TECHNICAL_DETAIL_PATTERN.test(message)) {
    const beforeDetails = message.split(/:\s*(?=SQLSTATE|PDOException|TypeError|ReferenceError|SyntaxError|HTTP\s*\d+|Graph API|Cloud API|webhook|cURL|unknown column|unexpected token)/i)[0].trim();
    if (beforeDetails && beforeDetails !== message && !TECHNICAL_DETAIL_PATTERN.test(beforeDetails)) message = beforeDetails;
    else return fallback;
  }

  message = message.replace(/^failed to\s+/i, 'Could not ');
  message = message.replace(/\bunknown error\b/gi, 'Please try again');
  return message || fallback;
}

export function toastMessage(value: unknown, type: 'success' | 'error' | 'warning' | 'info'): string {
  const message = typeof value === 'string' ? value : String(value ?? '');
  if (type === 'error' || type === 'warning') return userFacingErrorMessage(message);

  const safeMessage = removeStackAndPaths(message);
  const fallback = type === 'success' ? 'Done.' : 'Please wait...';
  if (!safeMessage || OPAQUE_VALUE_PATTERN.test(safeMessage) || TECHNICAL_DETAIL_PATTERN.test(safeMessage)) return fallback;
  return safeMessage;
}
