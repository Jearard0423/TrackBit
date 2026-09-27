<?php
declare(strict_types=1);

$envFile = __DIR__ . '/.env';
if (is_readable($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        if (!preg_match('/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/', $line, $matches)) {
            continue;
        }

        $value = trim($matches[2]);
        if (strlen($value) >= 2 && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) {
            $value = substr($value, 1, -1);
        }
        if (getenv($matches[1]) === false) {
            putenv($matches[1] . '=' . $value);
        }
    }
}

$requestPath = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
if (str_contains($requestPath, "\0") || preg_match('~(?:^|/)\.~', $requestPath)) {
    http_response_code(404);
    exit;
}

$requestedFile = realpath(__DIR__ . $requestPath);
if (
    $requestedFile !== false
    && str_starts_with($requestedFile, __DIR__ . DIRECTORY_SEPARATOR)
    && is_file($requestedFile)
) {
    return false;
}

if ($requestPath === '/' || $requestPath === '/index.html') {
    return false;
}

http_response_code(404);
echo 'Not found';