<?php
// Entry point: the playground writes the job to /tmp/in.json and reads the answer from /tmp/out.json.
define('PG_ROOT', getenv('PG_ROOT') ?: '');
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
ini_set('display_errors', '0');
foreach (['support', 'http', 'database', 'model', 'schema', 'bootstrap'] as $f) require_once __DIR__ . '/' . $f . '.php';

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Kernel;
use Illuminate\Http\Request;

$start = microtime(true);
$job = json_decode(file_get_contents(PG_ROOT . '/tmp/in.json'), true);
$result = ['ok' => true];
$app = null;
try {
    $app = Application::boot();
    switch ($job['kind']) {
        case 'request':
            $req = Request::create($job['method'], $job['uri'], $job['headers'] ?? [], $job['body'] ?? '');
            $res = (new Kernel($app))->handle($req);
            $content = $res->getContent();
            $result += ['status' => $res->getStatusCode(), 'headers' => $res->getHeaders(), 'body' => is_string($content) ? $content : (string) $content];
            if ($job['method'] === 'HEAD') $result['body'] = '';
            break;
        case 'artisan':
            $code = Illuminate\Console\Artisan::run($job['command'], $job['options'] ?? []);
            $result += ['output' => implode("\n", Illuminate\Console\Artisan::$out), 'exit' => $code];
            break;
        case 'tinker':
            $result += Illuminate\Console\Artisan::tinker($job['code']);
            break;
        default:
            throw new RuntimeException('Unknown job ' . $job['kind']);
    }
} catch (Throwable $e) {
    $result = ['ok' => false, 'error' => get_class($e) . ': ' . $e->getMessage(), 'file' => basename($e->getFile()), 'line' => $e->getLine()];
}
$result['queries'] = $app && $app->dbConn ? $app->dbConn->getQueryLog() : [];
$result['logs'] = Illuminate\Support\Facades\Log::$entries;
$result['dumps'] = $app ? $app->debug['dumps'] : [];
$result['ms'] = round((microtime(true) - $start) * 1000, 1);
file_put_contents(PG_ROOT . '/tmp/out.json', json_encode($result, JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR));
