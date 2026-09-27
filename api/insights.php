<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    respond(405, ['error' => 'Method not allowed']);
}

$authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches)) {
    respond(401, ['error' => 'Sign in to request insights']);
}

$input = json_decode(file_get_contents('php://input') ?: '', true);
$targetDateValue = is_array($input) ? ($input['targetDate'] ?? null) : null;
$userId = is_array($input) ? ($input['userId'] ?? null) : null;
if (!is_string($targetDateValue)) {
    respond(400, ['error' => 'A target date is required']);
}
if (!is_string($userId) || !preg_match('/^[A-Za-z0-9_-]{1,128}$/', $userId)) {
    respond(400, ['error' => 'A valid user is required']);
}

$targetDate = DateTimeImmutable::createFromFormat('!Y-m-d', $targetDateValue);
if (!$targetDate || $targetDate->format('Y-m-d') !== $targetDateValue) {
    respond(400, ['error' => 'The target date must use YYYY-MM-DD']);
}

$databaseUrl = rtrim((string) getenv('FIREBASE_DATABASE_URL'), '/');
$geminiApiKey = (string) getenv('GEMINI_API_KEY');
$databaseParts = parse_url($databaseUrl);
if (!$databaseParts || ($databaseParts['scheme'] ?? '') !== 'https' || empty($databaseParts['host']) || $geminiApiKey === '') {
    respond(503, ['error' => 'Progress analysis is not configured on the server']);
}

$startDate = $targetDate->modify('-7 days')->format('Y-m-d');
$endDate = $targetDate->format('Y-m-d');
$lastIncludedDate = $targetDate->modify('-1 day')->format('Y-m-d');
$bitsUrl = recentNodeUrl($databaseUrl, $userId, 'bits', 'date', $startDate, $lastIncludedDate, $matches[1]);
$tasksUrl = recentNodeUrl($databaseUrl, $userId, 'tasks', 'date', $startDate, $lastIncludedDate, $matches[1]);
$sleepUrl = recentNodeUrl($databaseUrl, $userId, 'sleep', '$key', $startDate, $lastIncludedDate, $matches[1]);
[$bitsStatus, $bits] = requestJson($bitsUrl, 'GET');
[$tasksStatus, $tasks] = requestJson($tasksUrl, 'GET');
[$sleepStatus, $sleep] = requestJson($sleepUrl, 'GET');
foreach ([$bitsStatus, $tasksStatus, $sleepStatus] as $status) {
    if ($status === 401 || $status === 403) {
        respond(401, ['error' => 'Your sign-in has expired. Sign in again and retry.']);
    }
    if ($status < 200 || $status >= 300) {
        error_log('TrackBit Realtime Database analysis read failed with status ' . $status);
        respond(502, ['error' => 'Progress data could not be loaded']);
    }
}

$recent = [
    'bits' => recentEntries($bits, $startDate, $endDate, ['date', 'title', 'unit', 'plannedAmount', 'actualAmount', 'reason', 'reflection']),
    'tasks' => recentEntries($tasks, $startDate, $endDate, ['date', 'title', 'completed']),
    'sleep' => recentSleep($sleep, $startDate, $endDate),
];

$prompt = "Analyze this user's self-tracked data from the seven days before {$endDate}. Be supportive, specific, and nonjudgmental. Identify only patterns supported by the data; say when there is not enough data. Do not diagnose or prescribe medical advice based on sleep. Do not treat missed targets as moral failure. Suggest at most three small, realistic next actions, and only suggest an action where the records give a useful basis. Return JSON matching the requested schema.\n\nData:\n" . json_encode($recent, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
$requestBody = [
    'systemInstruction' => [
        'parts' => [[
            'text' => 'You are TrackBit, a private personal progress reflection assistant. Analyze only the supplied records. Never claim causation from simple co-occurrence. Sleep is wellness data: do not diagnose conditions or recommend medical treatment.',
        ]],
    ],
    'contents' => [['role' => 'user', 'parts' => [['text' => $prompt]]]],
    'generationConfig' => [
        'temperature' => 0.2,
        'maxOutputTokens' => 900,
        'responseMimeType' => 'application/json',
        'responseSchema' => [
            'type' => 'OBJECT',
            'properties' => [
                'summary' => ['type' => 'STRING'],
                'patterns' => ['type' => 'ARRAY', 'items' => ['type' => 'STRING']],
                'suggestions' => [
                    'type' => 'ARRAY',
                    'items' => [
                        'type' => 'OBJECT',
                        'properties' => [
                            'title' => ['type' => 'STRING'],
                            'plannedAmount' => ['type' => 'NUMBER'],
                            'unit' => ['type' => 'STRING'],
                            'basis' => ['type' => 'STRING'],
                        ],
                        'required' => ['title', 'plannedAmount', 'unit', 'basis'],
                    ],
                ],
            ],
            'required' => ['summary', 'patterns', 'suggestions'],
        ],
    ],
];
$geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';
[$geminiStatus, $geminiResponse] = requestJson($geminiUrl, 'POST', $requestBody, ['x-goog-api-key: ' . $geminiApiKey]);
if ($geminiStatus < 200 || $geminiStatus >= 300) {
    error_log('TrackBit Gemini analysis failed with status ' . $geminiStatus);
    respond(502, ['error' => 'Gemini could not analyze your progress right now']);
}

$analysisText = $geminiResponse['candidates'][0]['content']['parts'][0]['text'] ?? '';
$analysis = json_decode($analysisText, true);
if (!is_array($analysis) || !isset($analysis['summary'])) {
    error_log('TrackBit Gemini returned an invalid analysis payload');
    respond(502, ['error' => 'The analysis response could not be read']);
}

$suggestions = [];
foreach (array_slice(is_array($analysis['suggestions'] ?? null) ? $analysis['suggestions'] : [], 0, 3) as $suggestion) {
    $title = trim((string) ($suggestion['title'] ?? ''));
    $amount = $suggestion['plannedAmount'] ?? null;
    $unit = trim((string) ($suggestion['unit'] ?? ''));
    if ($title === '' || !is_numeric($amount) || (float) $amount <= 0 || (float) $amount > 100000 || $unit === '') {
        continue;
    }
    $suggestions[] = [
        'title' => mb_substr($title, 0, 80),
        'plannedAmount' => round((float) $amount, 1),
        'unit' => mb_substr($unit, 0, 24),
        'basis' => mb_substr(trim((string) ($suggestion['basis'] ?? '')), 0, 180),
    ];
}

respond(200, [
    'analysis' => [
        'summary' => mb_substr(trim((string) $analysis['summary']), 0, 1200),
        'patterns' => array_slice(array_map(static fn ($item): string => mb_substr(trim((string) $item), 0, 220), array_filter(is_array($analysis['patterns'] ?? null) ? $analysis['patterns'] : [], 'is_string')), 0, 5),
        'suggestions' => $suggestions,
    ],
]);

function requestJson(string $url, string $method, ?array $payload = null, array $extraHeaders = []): array
{
    $options = [
        'method' => $method,
        'header' => implode("\r\n", array_merge(['Accept: application/json'], $extraHeaders)),
        'timeout' => 20,
        'ignore_errors' => true,
    ];
    if ($payload !== null) {
        $options['header'] .= "\r\nContent-Type: application/json";
        $options['content'] = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
    $context = stream_context_create(['http' => $options]);
    $response = @file_get_contents($url, false, $context);
    $statusLine = $http_response_header[0] ?? '';
    preg_match('/\s(\d{3})\s/', $statusLine, $matches);
    $status = isset($matches[1]) ? (int) $matches[1] : 0;
    $data = is_string($response) ? json_decode($response, true) : null;
    return [$status, is_array($data) ? $data : []];
}

function recentNodeUrl(string $databaseUrl, string $userId, string $node, string $orderBy, string $startDate, string $endDate, string $idToken): string
{
    $query = http_build_query([
        'auth' => $idToken,
        'orderBy' => json_encode($orderBy, JSON_THROW_ON_ERROR),
        'startAt' => json_encode($startDate, JSON_THROW_ON_ERROR),
        'endAt' => json_encode($endDate, JSON_THROW_ON_ERROR),
    ], '', '&', PHP_QUERY_RFC3986);
    return rtrim($databaseUrl, '/') . '/users/' . rawurlencode($userId) . '/' . rawurlencode($node) . '.json?' . $query;
}

function recentEntries(mixed $entries, string $startDate, string $endDate, array $fields): array
{
    if (!is_array($entries)) {
        return [];
    }
    $recent = [];
    foreach ($entries as $entry) {
        if (!is_array($entry) || !is_string($entry['date'] ?? null)) {
            continue;
        }
        if ($entry['date'] < $startDate || $entry['date'] >= $endDate) {
            continue;
        }
        $selected = array_intersect_key($entry, array_flip($fields));
        foreach ($selected as $key => $value) {
            if (is_string($value)) {
                $selected[$key] = mb_substr($value, 0, $key === 'reflection' ? 400 : 100);
            } elseif (!is_numeric($value) && !is_bool($value)) {
                unset($selected[$key]);
            }
        }
        $recent[] = $selected;
        if (count($recent) >= 50) {
            break;
        }
    }
    return $recent;
}

function recentSleep(mixed $records, string $startDate, string $endDate): array
{
    if (!is_array($records)) {
        return [];
    }
    $recent = [];
    foreach ($records as $date => $record) {
        if (!is_string($date) || $date < $startDate || $date >= $endDate || !is_array($record)) {
            continue;
        }
        $recent[] = array_intersect_key($record + ['date' => $date], array_flip(['date', 'hours', 'targetHours', 'quality']));
    }
    return array_slice($recent, -14);
}