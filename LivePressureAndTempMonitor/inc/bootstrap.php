<?php
declare(strict_types=1);

if (PHP_VERSION_ID < 80000) {
    http_response_code(500);
    exit('PHP 8.0 or newer is required.');
}

$configPath = dirname(__DIR__) . '/config.php';
if (!is_file($configPath)) {
    http_response_code(500);
    exit('Setup required: rename config.example.php to config.php and enter the database settings.');
}

/** @var array<string,mixed> $config */
$config = require $configPath;

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

require_once __DIR__ . '/persistent-auth.php';

function app_config(string $key, mixed $default = null): mixed
{
    global $config;
    return $config[$key] ?? $default;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', app_config('db_host'), app_config('db_name'));
    $pdo = new PDO($dsn, (string) app_config('db_user'), (string) app_config('db_password'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function is_host_signed_in(): bool
{
    return !empty($_SESSION['pressure_host_authenticated']);
}

function verify_host_password(string $password): bool
{
    $expected = (string) app_config('host_password', '');
    return $expected !== '' && hash_equals($expected, $password);
}

function require_host(): void
{
    if (!is_host_signed_in()) {
        json_response(['error' => 'Host sign-in is required.'], 403);
    }
}

function csrf_token(): string
{
    if (empty($_SESSION['pressure_csrf'])) {
        $_SESSION['pressure_csrf'] = bin2hex(random_bytes(24));
    }
    return (string) $_SESSION['pressure_csrf'];
}

function require_csrf(): void
{
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if ($provided === '' || !hash_equals(csrf_token(), $provided)) {
        json_response(['error' => 'The host security token expired. Refresh the host page and try again.'], 403);
    }
}

function json_input(): array
{
    $raw = file_get_contents('php://input');
    $decoded = json_decode($raw ?: '{}', true);
    if (!is_array($decoded)) {
        json_response(['error' => 'Invalid JSON request.'], 400);
    }
    return $decoded;
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function random_hex(int $bytes): string
{
    return bin2hex(random_bytes($bytes));
}

function clean_unit(mixed $value): string
{
    $unit = strtoupper((string) ($value ?: 'PSI'));
    return preg_match('/^[A-Z0-9\/\-\.]{1,12}$/', $unit) ? $unit : 'PSI';
}

function base_url(): string
{
    return rtrim((string) app_config('base_url', ''), '/');
}

function google_sheet_enabled(): bool
{
    return trim((string) app_config('google_apps_script_url', '')) !== ''
        && trim((string) app_config('google_sheet_sync_secret', '')) !== '';
}

function google_sheet_request(array $payload): array
{
    $url = trim((string) app_config('google_apps_script_url', ''));
    $secret = trim((string) app_config('google_sheet_sync_secret', ''));
    $parts = parse_url($url);
    if ($secret === '' || !is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || ($parts['host'] ?? '') !== 'script.google.com'
        || !preg_match('#^/macros/s/[A-Za-z0-9_-]+/exec$#', (string) ($parts['path'] ?? ''))) {
        throw new RuntimeException('Google Sheet setup is incomplete. Add the Apps Script URL and synchronization secret to config.php.');
    }
    $payload['secret'] = $secret;
    $json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    if (!is_string($json) || strlen($json) > 750000) {
        throw new RuntimeException('The Google Sheet update was too large. Finalize using the locally stored test data.');
    }

    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $json,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 4,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 35,
            CURLOPT_USERAGENT => 'GrantG-Hydrotest-Sheet-Sync/1.0',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        ]);
        $raw = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $error = curl_error($handle);
        curl_close($handle);
        if (!is_string($raw) || $status < 200 || $status >= 300) {
            throw new RuntimeException($error !== '' ? 'Google Sheet connection failed: ' . $error : 'Google Sheet connection returned an unexpected response.');
        }
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\nUser-Agent: GrantG-Hydrotest-Sheet-Sync/1.0\r\n",
                'content' => $json,
                'timeout' => 35,
                'follow_location' => 1,
                'max_redirects' => 4,
                'ignore_errors' => true,
            ],
        ]);
        $raw = @file_get_contents($url, false, $context);
        if (!is_string($raw)) throw new RuntimeException('The website could not reach Google Apps Script.');
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) throw new RuntimeException('Google Apps Script did not return valid JSON. Check the web-app deployment permissions.');
    if (empty($decoded['ok'])) throw new RuntimeException(trim((string) ($decoded['error'] ?? 'Google Sheet synchronization failed.')));
    unset($decoded['secret']);
    return $decoded;
}
