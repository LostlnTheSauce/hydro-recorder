<?php
declare(strict_types=1);

// A signed, HttpOnly trusted-device cookie restores the PHP session after host
// garbage collection. Password changes invalidate it; signing out deletes it.
function host_remember_key(): string {
    return hash('sha256', 'hydro-trusted-device-v1|' . (string) app_config('host_password') . '|' . (string) app_config('db_password'), true);
}
function host_remember_decode(string $value): ?array {
    $parts = explode('.', $value);
    if (count($parts) !== 2 || !hash_equals(hash_hmac('sha256', $parts[0], host_remember_key()), $parts[1])) return null;
    $data = json_decode(base64_decode($parts[0], true) ?: '', true);
    if (!is_array($data) || ($data['expires'] ?? 0) < time() || !preg_match('/^[a-f0-9]{48}$/', (string) ($data['csrf'] ?? ''))) return null;
    return $data;
}
function remember_host(): void {
    $body = base64_encode(json_encode(['expires' => time() + 365 * 86400, 'csrf' => csrf_token()]));
    $value = $body . '.' . hash_hmac('sha256', $body, host_remember_key());
    setcookie('hydro_trusted_host', $value, ['expires' => time() + 365 * 86400, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Strict']);
}
function forget_host(): void {
    setcookie('hydro_trusted_host', '', ['expires' => 1, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Strict']);
}
function restore_trusted_host(): void {
    $trusted = host_remember_decode((string) ($_COOKIE['hydro_trusted_host'] ?? ''));
    if (!is_host_signed_in() && $trusted) {
        session_regenerate_id(true);
        $_SESSION['pressure_host_authenticated'] = true;
        $_SESSION['pressure_csrf'] = $trusted['csrf'];
    }
    if (is_host_signed_in() && (!$trusted || $trusted['expires'] < time() + 330 * 86400)) remember_host();
}
restore_trusted_host();
