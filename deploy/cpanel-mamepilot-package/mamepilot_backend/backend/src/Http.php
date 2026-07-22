<?php

declare(strict_types=1);

namespace App;

final class Http
{
    private const GENERIC_ERROR = 'We could not complete this action. Please try again. If the problem continues, ask an administrator for help.';

    /**
     * @return array<string, mixed>
     */
    public static function jsonBody(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param mixed $data
     */
    public static function respond(int $status, $data): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, Mh-Piprapay-Api-Key, mh-piprapay-api-key, X-Piprapay-Signature');
        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * @param mixed $data
     */
    public static function ok($data): void
    {
        self::respond(200, $data);
    }

    public static function error(int $status, string $message, array $extra = []): void
    {
        self::respond($status, array_merge(['error' => $message], $extra));
    }

    public static function safeErrorMessage(string $message, string $fallback = self::GENERIC_ERROR): string
    {
        $message = trim(str_replace("\0", '', $message));
        $message = preg_split('/\s+\[(?=(?:[A-Za-z]:\\\\|\/home\/|\/var\/www\/))/', $message, 2)[0] ?? '';
        $message = preg_split('/(?:\r?\n|\s+)#0\s+/', $message, 2)[0] ?? '';
        $message = preg_split('/\s+\|\s+#0\s+/', $message, 2)[0] ?? '';
        $message = trim((string) preg_replace('/\s+/', ' ', $message));
        if ($message === '' || preg_match('/^(unknown error|unknown action|missing action)\.?$/i', $message)) return $fallback;
        if (preg_match('/authentication required|session (?:has )?expired|invalid session/i', $message)) return 'Your session has expired. Please sign in again.';
        if (preg_match('/admin access required|developer access required|permission denied|not authorized|forbidden/i', $message)) return 'You do not have permission to do this.';
        if (preg_match('/timeout|timed out/i', $message)) return 'This is taking longer than expected. Please try again.';
        if (preg_match('/not configured|configuration (?:is )?required|credentials? (?:are|is) required|finish (?:the )?setup/i', $message)) return 'This service is not ready yet. Ask an administrator to finish the setup in Settings.';
        if (preg_match('/SQLSTATE|PDOException|TypeError|ReferenceError|SyntaxError|stack trace|\bcurl\b|\bHTTP\s*\d{3}\b|\b(?:Graph|Cloud)?\s*API\b|\bwebhook\b|\bcallback\b|\bendpoint\b|\bdatabase\b|\bquery\b|\bpayload\b|access[_ -]?token|app[_ -]?secret|credentials?|unknown column|integrity constraint|foreign key constraint|\.php\(?\d+\)?|node_modules|vendor[\\\\\/]|[A-Za-z]:\\\\|\/home\/|\/var\/www\//i', $message)) return $fallback;
        return preg_replace('/^failed to\s+/i', 'Could not ', $message) ?: $fallback;
    }

    public static function unexpectedError(\Throwable $exception): void
    {
        $requestId = substr(bin2hex(random_bytes(8)), 0, 12);
        error_log(sprintf('[MamePilot %s] %s in %s:%d\n%s', $requestId, $exception->getMessage(), $exception->getFile(), $exception->getLine(), $exception->getTraceAsString()));
        $message = $exception->getMessage();
        if ($message === 'Authentication required.') {
            self::error(401, 'Your session has expired. Please sign in again.', ['code' => 'AUTHENTICATION_REQUIRED']);
            return;
        }
        if ($message === 'Admin access required.' || $message === 'Developer access required.') {
            self::error(403, 'You do not have permission to do this.', ['code' => 'ACCESS_DENIED']);
            return;
        }
        if ($exception instanceof \RuntimeException && !($exception instanceof \PDOException)) {
            self::error(400, self::safeErrorMessage($message), ['code' => 'ACTION_NOT_COMPLETED']);
            return;
        }
        self::error(500, self::GENERIC_ERROR, ['code' => 'SERVER_ERROR', 'requestId' => $requestId]);
    }

    public static function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    public static function path(): string
    {
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $path = parse_url($uri, PHP_URL_PATH);
        return is_string($path) ? $path : '/';
    }

    public static function bearerToken(): ?string
    {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['Authorization'] ?? null;
        if (!$header || !preg_match('/Bearer\s+(.+)$/i', $header, $matches)) {
            return null;
        }

        return trim($matches[1]);
    }
}
