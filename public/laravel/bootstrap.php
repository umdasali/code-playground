<?php
// Laravel-style mini framework: facades, router, HTTP kernel, Artisan commands and Tinker.

namespace Illuminate\Routing {

use Closure;
use Illuminate\Container\Container;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;

class Route
{
    public array $middleware = [];
    public array $wheres = [];
    public ?string $name = null;
    public ?string $controller = null;

    public function __construct(public array $methods, public string $uri, public $action) {}
    public function name(string $n): static { $this->name = ($this->name ?? '') . $n; return $this; }
    public function middleware(...$m): static { foreach ($m as $x) foreach ((array) $x as $y) $this->middleware[] = $y; return $this; }
    public function withoutMiddleware(...$m): static { return $this; }
    public function where($name, ?string $expr = null): static { if (is_array($name)) $this->wheres = array_merge($this->wheres, $name); else $this->wheres[$name] = $expr; return $this; }
    public function whereNumber(string $n): static { return $this->where($n, '[0-9]+'); }
    public function whereAlpha(string $n): static { return $this->where($n, '[a-zA-Z]+'); }
    public function whereUuid(string $n): static { return $this->where($n, '[0-9a-fA-F-]{36}'); }
    public function getName(): ?string { return $this->name; }
    public function methods(): array { return $this->methods; }

    public function regex(): string
    {
        $uri = trim($this->uri, '/');
        $pattern = preg_replace_callback('#/?\{(\w+)(\?)?\}#', function ($m) {
            $expr = $this->wheres[$m[1]] ?? '[^/]+';
            return $m[2] ?? false ? '(?:/(?P<' . $m[1] . '>' . $expr . '))?' : '/(?P<' . $m[1] . '>' . $expr . ')';
        }, '/' . $uri);
        return '#^' . ($uri === '' ? '/?' : $pattern) . '/?$#';
    }
    public function matches(string $path): ?array
    {
        if (!preg_match($this->regex(), '/' . trim($path, '/'), $m)) return null;
        return array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
    }
}

class PendingResource
{
    public function __construct(protected Router $router, protected array $routes) {}
    public function only($m): static { return $this->keep(fn ($a) => in_array($a, (array) $m, true)); }
    public function except($m): static { return $this->keep(fn ($a) => !in_array($a, (array) $m, true)); }
    protected function keep(callable $f): static
    {
        foreach ($this->routes as $action => $route) if (!$f($action)) $this->router->forget($route);
        return $this;
    }
    public function names($n): static { return $this; }
    public function middleware(...$m): static { foreach ($this->routes as $r) $r->middleware(...$m); return $this; }
}

class RouteRegistrar
{
    public function __construct(protected Router $router, protected array $attributes = []) {}
    public function __call($method, $args)
    {
        if (in_array($method, ['prefix', 'middleware', 'name', 'controller', 'where', 'namespace', 'domain', 'withoutMiddleware'], true)) {
            $a = $this->attributes;
            if ($method === 'middleware') $a['middleware'] = array_merge($a['middleware'] ?? [], is_array($args[0]) ? $args[0] : $args);
            elseif ($method === 'where') $a['where'] = array_merge($a['where'] ?? [], is_array($args[0]) ? $args[0] : [$args[0] => $args[1]]);
            elseif ($method === 'prefix') $a['prefix'] = trim(($a['prefix'] ?? '') . '/' . trim($args[0], '/'), '/');
            elseif ($method === 'name') $a['name'] = ($a['name'] ?? '') . $args[0];
            else $a[$method] = $args[0];
            return new static($this->router, $a);
        }
        if ($method === 'group') return $this->router->group($this->attributes, $args[0]);
        return $this->router->withAttributes($this->attributes, fn () => $this->router->$method(...$args));
    }
}

class Router
{
    /** @var Route[] */
    public array $routes = [];
    protected array $stack = [];
    protected ?Route $fallbackRoute = null;
    protected array $aliases = [];

    public function __construct(protected Container $container) {}

    public function forget(Route $r): void { $this->routes = array_values(array_filter($this->routes, fn ($x) => $x !== $r)); }
    public function withAttributes(array $attrs, callable $cb) { $this->stack[] = $attrs; try { return $cb(); } finally { array_pop($this->stack); } }

    protected function merged(string $key, $default = null) { $out = $default; foreach ($this->stack as $s) if (isset($s[$key])) { if ($key === 'prefix') $out = trim(($out ?? '') . '/' . trim($s[$key], '/'), '/'); elseif (in_array($key, ['middleware', 'where'], true)) $out = array_merge($out ?? [], $s[$key]); elseif ($key === 'name') $out = ($out ?? '') . $s[$key]; else $out = $s[$key]; } return $out; }

    public function addRoute(array $methods, string $uri, $action): Route
    {
        $prefix = $this->merged('prefix', '');
        $full = trim(($prefix ? $prefix . '/' : '') . trim($uri, '/'), '/');
        $controller = $this->merged('controller');
        if ($controller && is_string($action) && !str_contains($action, '@')) $action = [$controller, $action];
        $route = new Route($methods, '/' . $full, $action);
        $route->middleware(...($this->merged('middleware', []) ?? []));
        $route->wheres = $this->merged('where', []) ?? [];
        $this->routes[] = $route;
        return $route;
    }
    public function get(string $u, $a = null): Route { return $this->addRoute(['GET', 'HEAD'], $u, $a); }
    public function post(string $u, $a = null): Route { return $this->addRoute(['POST'], $u, $a); }
    public function put(string $u, $a = null): Route { return $this->addRoute(['PUT'], $u, $a); }
    public function patch(string $u, $a = null): Route { return $this->addRoute(['PATCH'], $u, $a); }
    public function delete(string $u, $a = null): Route { return $this->addRoute(['DELETE'], $u, $a); }
    public function options(string $u, $a = null): Route { return $this->addRoute(['OPTIONS'], $u, $a); }
    public function any(string $u, $a = null): Route { return $this->addRoute(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], $u, $a); }
    public function match(array $m, string $u, $a = null): Route { return $this->addRoute(array_map('strtoupper', $m), $u, $a); }
    public function fallback($a): Route { return $this->fallbackRoute = new Route(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], '/{fallbackPlaceholder}', $a); }
    public function view(string $uri, string $view, array $data = []): Route { return $this->get($uri, fn () => response()->json(['view' => $view, 'data' => $data])); }
    public function redirect(string $a, string $b, int $s = 302): Route { return $this->any($a, fn () => response()->json(['redirect' => $b], $s)); }
    public function group($attrs, $routes)
    {
        if (is_string($attrs)) $attrs = ['prefix' => $attrs];
        $this->stack[] = $attrs;
        try { $routes instanceof Closure ? $routes($this) : require $routes; } finally { array_pop($this->stack); }
    }
    public function prefix(string $p): RouteRegistrar { return (new RouteRegistrar($this))->prefix($p); }
    public function middleware(...$m): RouteRegistrar { return (new RouteRegistrar($this))->middleware(...$m); }
    public function name(string $n): RouteRegistrar { return (new RouteRegistrar($this))->name($n); }
    public function controller(string $c): RouteRegistrar { return (new RouteRegistrar($this))->controller($c); }
    public function where(...$a): RouteRegistrar { return (new RouteRegistrar($this))->where(...$a); }
    public function aliasMiddleware(string $n, string $c): void { $this->aliases[$n] = $c; }

    protected function buildResource(string $name, string $controller, array $actions): PendingResource
    {
        $segments = explode('.', $name);
        $uri = '';
        foreach ($segments as $i => $seg) {
            $uri .= ($i ? '/' : '') . $seg;
            if ($i < count($segments) - 1) $uri .= '/{' . Str::snake(Str::singular($seg)) . '}';
        }
        $param = Str::snake(Str::singular(end($segments)));
        $made = [];
        $defs = [
            'index' => [['GET', 'HEAD'], $uri], 'create' => [['GET', 'HEAD'], "$uri/create"], 'store' => [['POST'], $uri],
            'show' => [['GET', 'HEAD'], "$uri/{{$param}}"], 'edit' => [['GET', 'HEAD'], "$uri/{{$param}}/edit"],
            'update' => [['PUT', 'PATCH'], "$uri/{{$param}}"], 'destroy' => [['DELETE'], "$uri/{{$param}}"],
        ];
        foreach ($defs as $action => [$methods, $u]) {
            if (!in_array($action, $actions, true)) continue;
            $r = $this->addRoute($methods, $u, [$controller, $action]);
            $r->name = ($this->merged('name', '') ?? '') . $name . '.' . $action;
            $made[$action] = $r;
        }
        return new PendingResource($this, $made);
    }
    public function apiResource(string $name, string $controller): PendingResource { return $this->buildResource($name, $controller, ['index', 'store', 'show', 'update', 'destroy']); }
    public function resource(string $name, string $controller, array $options = []): PendingResource
    {
        $p = $this->buildResource($name, $controller, ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy']);
        if (isset($options['only'])) $p->only($options['only']);
        if (isset($options['except'])) $p->except($options['except']);
        return $p;
    }
    public function apiResources(array $r): void { foreach ($r as $n => $c) $this->apiResource($n, $c); }

    // ----- dispatching -----
    public function dispatch(Request $request)
    {
        $path = $request->path() === '/' ? '/' : '/' . $request->path();
        $method = $request->method();
        $allowed = [];
        foreach ($this->routes as $route) {
            $params = $route->matches($path);
            if ($params === null) continue;
            $m = $route->methods;
            if (!in_array($method, $m, true) && !($method === 'HEAD' && in_array('GET', $m, true))) { $allowed = array_merge($allowed, $m); continue; }
            return $this->run($route, $request, $params);
        }
        if ($this->fallbackRoute) return $this->run($this->fallbackRoute, $request, []);
        if ($allowed) throw new \Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException(array_values(array_unique($allowed)), "The $method method is not supported for route " . $request->path() . '. Supported methods: ' . implode(', ', array_values(array_unique($allowed))) . '.');
        throw new \Symfony\Component\HttpKernel\Exception\NotFoundHttpException('The route ' . $request->path() . ' could not be found.');
    }

    protected function run(Route $route, Request $request, array $params)
    {
        $request->setRouteParams($params, $route);
        $core = function (Request $req) use ($route, $params) {
            $action = $route->action;
            if (is_string($action) && !str_contains($action, '@') && class_exists($action)) $action = [$action, '__invoke'];
            if ($action === null) throw new \RuntimeException("Route [{$route->uri}] has no action.");
            return $this->container->call($action, $params + [Request::class => $req]);
        };
        $stack = $core;
        foreach (array_reverse($route->middleware) as $mw) {
            $handler = $this->resolveMiddleware($mw);
            if ($handler === null) continue;
            $next = $stack;
            $stack = fn (Request $req) => $handler($req, $next);
        }
        return $stack($request);
    }

    protected function resolveMiddleware($mw): ?Closure
    {
        if ($mw instanceof Closure) return fn ($req, $next) => $mw($req, $next);
        $name = is_string($mw) ? explode(':', $mw, 2)[0] : '';
        $class = $this->aliases[$name] ?? $name;
        if (is_string($mw) && class_exists($class)) {
            $obj = $this->container->make($class);
            $args = str_contains($mw, ':') ? explode(',', explode(':', $mw, 2)[1]) : [];
            return fn ($req, $next) => $obj->handle($req, $next, ...$args);
        }
        return null; // 'api', 'web', 'auth', 'throttle:60,1' and other built-in aliases are not simulated
    }
}

}

namespace Illuminate\Support\Facades {

use Illuminate\Container\Container;

abstract class Facade
{
    abstract protected static function root();
    public static function __callStatic($m, $a) { return static::root()->$m(...$a); }
}
class Route extends Facade { protected static function root() { return Container::getInstance()->make('router'); } }
class DB extends Facade
{
    protected static function root() { return Container::getInstance()->make('db'); }
    public static function connection($name = null) { return Container::getInstance()->make('db'); }
    public static function enableQueryLog(): void {}
    public static function listen(callable $cb): void {}
    public static function table($t, $as = null) { return static::root()->table($t, $as); }
}
class Schema extends Facade { protected static function root() { return new \Illuminate\Database\Schema\Schema; } public static function __callStatic($m, $a) { return \Illuminate\Database\Schema\Schema::$m(...$a); } public static function connection($n = null) { return new \Illuminate\Database\Schema\Schema; } }
class Validator extends Facade { protected static function root() { return new \Illuminate\Validation\Validator([], []); } public static function make(array $d, array $r, array $m = [], array $a = []) { return \Illuminate\Validation\Validator::make($d, $r, $m, $a); } }
class Hash extends Facade
{
    protected static function root() { return new class { public function make($v, $o = []) { return bcrypt($v, $o); } public function check($v, $h) { return password_verify((string) $v, (string) $h); } public function needsRehash($h) { return false; } }; }
}
class Log extends Facade
{
    public static array $entries = [];
    protected static function root() { return new class { public function __call($level, $a) { \Illuminate\Support\Facades\Log::$entries[] = ['level' => $level, 'message' => is_string($a[0] ?? '') ? ($a[0] ?? '') : json_encode($a[0]), 'context' => $a[1] ?? []]; } }; }
}
class Cache extends Facade
{
    protected static function store(): string { return PG_ROOT . '/tmp/pg-cache.json'; }
    protected static function load(): array { return is_file(static::store()) ? (json_decode(file_get_contents(static::store()), true) ?: []) : []; }
    protected static function save(array $d): void { file_put_contents(static::store(), json_encode($d)); }
    protected static function root() { return new static; }
    public static function put($k, $v, $ttl = null) { $d = static::load(); $d[$k] = ['v' => $v, 'exp' => $ttl ? time() + (is_int($ttl) ? $ttl : 3600) : null]; static::save($d); return true; }
    public static function get($k, $default = null) { $d = static::load(); if (!isset($d[$k]) || ($d[$k]['exp'] !== null && $d[$k]['exp'] < time())) return value($default); return $d[$k]['v']; }
    public static function has($k): bool { return static::get($k) !== null; }
    public static function forget($k) { $d = static::load(); unset($d[$k]); static::save($d); return true; }
    public static function flush() { static::save([]); return true; }
    public static function remember($k, $ttl, $cb) { if (($v = static::get($k)) !== null) return $v; $v = $cb(); static::put($k, $v, $ttl); return $v; }
    public static function forever($k, $v) { return static::put($k, $v); }
    public static function increment($k, $n = 1) { $v = (int) static::get($k, 0) + $n; static::put($k, $v); return $v; }
}
class Auth extends Facade
{
    protected static function root() { return new class { public function check() { return false; } public function user() { return null; } public function id() { return null; } public function guest() { return true; } }; }
}

}

namespace Illuminate\Foundation {

use Illuminate\Container\Container;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

class Application extends Container
{
    public array $env = [];
    public array $config = [];
    public array $debug = ['queries' => [], 'logs' => [], 'dumps' => []];
    public ?\Illuminate\Database\Connection $dbConn = null;

    public static function boot(): static
    {
        $app = new static;
        static::setInstance($app);
        $app->instance('app', $app);
        $app->instance(Container::class, $app);
        $app->registerAutoload();
        $app->loadEnv();
        $app->loadConfig();
        $app->instance('router', new \Illuminate\Routing\Router($app));
        $app->singleton('db', fn () => $app->dbConn = new \Illuminate\Database\Connection($app->env['DB_DATABASE'] ?? 'laravel'));
        set_error_handler(function ($no, $str, $file, $line) {
            if (!(error_reporting() & $no) || in_array($no, [E_DEPRECATED, E_USER_DEPRECATED], true)) return false;
            throw new \ErrorException($str, 0, $no, $file, $line);
        });
        $app->registerProviders();
        return $app;
    }

    protected function registerAutoload(): void
    {
        $maps = ['App\\' => PG_ROOT . '/app/', 'Database\\Factories\\' => PG_ROOT . '/database/factories/', 'Database\\Seeders\\' => PG_ROOT . '/database/seeders/'];
        spl_autoload_register(function ($class) use ($maps) {
            foreach ($maps as $prefix => $dir) {
                if (str_starts_with($class, $prefix)) {
                    $file = $dir . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
                    if (is_file($file)) require_once $file;
                    return;
                }
            }
        });
    }
    protected function loadEnv(): void
    {
        $this->env = ['APP_NAME' => 'Laravel', 'APP_ENV' => 'local', 'APP_DEBUG' => 'true', 'APP_URL' => 'http://localhost:8000', 'DB_CONNECTION' => 'mysql', 'DB_DATABASE' => 'laravel'];
        if (is_file(PG_ROOT . '/.env')) foreach (preg_split('/\R/', file_get_contents(PG_ROOT . '/.env')) as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) continue;
            [$k, $v] = explode('=', $line, 2);
            $this->env[trim($k)] = trim(trim($v), "\"'");
        }
    }
    protected function loadConfig(): void
    {
        $this->config = [
            'app' => ['name' => $this->env['APP_NAME'], 'env' => $this->env['APP_ENV'], 'debug' => filter_var($this->env['APP_DEBUG'], FILTER_VALIDATE_BOOLEAN), 'url' => $this->env['APP_URL'], 'timezone' => 'UTC', 'providers' => []],
            'database' => ['default' => $this->env['DB_CONNECTION'], 'connections' => ['mysql' => ['driver' => 'mysql', 'database' => $this->env['DB_DATABASE']]]],
        ];
        foreach (glob(PG_ROOT . '/config/*.php') ?: [] as $file) {
            $name = basename($file, '.php');
            $data = require $file;
            if (is_array($data)) $this->config[$name] = array_replace_recursive($this->config[$name] ?? [], $data);
        }
    }
    protected function registerProviders(): void
    {
        $providers = $this->config['app']['providers'] ?: [];
        if (!$providers && is_file(PG_ROOT . '/app/Providers/AppServiceProvider.php')) $providers = ['App\\Providers\\AppServiceProvider'];
        $objs = [];
        foreach ($providers as $p) { if (class_exists($p)) { $o = new $p($this); if (method_exists($o, 'register')) $o->register(); $objs[] = $o; } }
        foreach ($objs as $o) if (method_exists($o, 'boot')) $o->boot();
    }
    public function loadRoutes(): void
    {
        $router = $this->make('router');
        if (is_file(PG_ROOT . '/routes/web.php')) { $router->group([], function () { require PG_ROOT . '/routes/web.php'; }); }
        if (is_file(PG_ROOT . '/routes/api.php')) { $router->group(['prefix' => 'api'], function () { require PG_ROOT . '/routes/api.php'; }); }
    }
}

class Kernel
{
    public function __construct(protected Application $app) {}

    public function handle(Request $request): Response|JsonResponse
    {
        $this->app->instance('request', $request);
        $this->app->instance(Request::class, $request);
        try {
            $this->app->loadRoutes();
            $result = $this->app->make('router')->dispatch($request);
            return $this->toResponse($result, $request);
        } catch (\Throwable $e) {
            return $this->render($e, $request);
        }
    }

    public function toResponse($result, Request $request)
    {
        if ($result instanceof \Symfony\Component\HttpFoundation\Response) return $result;
        if ($result instanceof \Illuminate\Http\Resources\Json\JsonResource) {
            $status = ($result->resource instanceof \Illuminate\Database\Eloquent\Model && $result->resource->wasRecentlyCreated && $request->isMethod('POST')) ? 201 : 200;
            return new JsonResponse($result->toResponse($request), $status);
        }
        if ($result instanceof \Illuminate\Pagination\LengthAwarePaginator) return new JsonResponse($result->toArray());
        if (is_array($result) || $result instanceof \JsonSerializable || $result instanceof \Illuminate\Contracts\Support\Arrayable || is_object($result) && !method_exists($result, '__toString')) {
            return new JsonResponse($result instanceof \Illuminate\Contracts\Support\Arrayable && !($result instanceof \JsonSerializable) ? $result->toArray() : $result);
        }
        if ($result === null) return new Response('', 200);
        if (is_bool($result)) return new Response($result ? '1' : '', 200);
        return new Response((string) $result, 200, ['Content-Type' => 'text/html; charset=UTF-8']);
    }

    public function render(\Throwable $e, Request $request): JsonResponse|Response
    {
        $debug = $this->app->config['app']['debug'];
        if ($e instanceof DumpException) return new Response($e->output, 200, ['Content-Type' => 'text/plain; charset=UTF-8']);
        if ($e instanceof ValidationException) return new JsonResponse(['message' => $e->getMessage(), 'errors' => $e->errors()], 422);
        if ($e instanceof \Illuminate\Database\Eloquent\ModelNotFoundException) return new JsonResponse(['message' => $debug ? $e->getMessage() : 'Not Found.'] + ($debug ? ['exception' => get_class($e)] : []), 404);
        if ($e instanceof \Illuminate\Auth\AuthenticationException) return new JsonResponse(['message' => 'Unauthenticated.'], 401);
        if ($e instanceof \Symfony\Component\HttpKernel\Exception\HttpException) {
            $msg = $e->getMessage() ?: [403 => 'Forbidden', 404 => 'Not Found', 405 => 'Method Not Allowed', 429 => 'Too Many Requests', 500 => 'Server Error', 503 => 'Service Unavailable'][$e->getStatusCode()] ?? 'Error';
            return new JsonResponse(['message' => $msg], $e->getStatusCode(), $e->getHeaders());
        }
        $body = ['message' => $debug ? $e->getMessage() : 'Server Error'];
        if ($debug) {
            $body += ['exception' => get_class($e), 'file' => $e->getFile(), 'line' => $e->getLine(), 'trace' => array_map(fn ($t) => ['file' => $t['file'] ?? null, 'line' => $t['line'] ?? null, 'function' => ($t['class'] ?? '') . ($t['type'] ?? '') . ($t['function'] ?? '')], array_slice($e->getTrace(), 0, 8))];
        }
        return new JsonResponse($body, 500);
    }
}

class DumpException extends \RuntimeException { public function __construct(public string $output) { parent::__construct('dd'); } }

}

namespace Illuminate\Console {

use Illuminate\Container\Container;

class Artisan
{
    public static array $out = [];
    public static function line(string $s = ''): void { self::$out[] = $s; }
    public static function info(string $s): void { self::line('   INFO  ' . $s); self::line(); }
    protected static function pad(string $left, string $right): string { return '  ' . $left . ' ' . str_repeat('.', max(2, 76 - strlen($left) - strlen($right))) . ' ' . $right; }

    protected static function conn() { return \Illuminate\Support\Facades\DB::connection(); }
    protected static function ensureMigrationsTable(): void
    {
        self::conn()->statement('create table if not exists "migrations" ("id" integer primary key autoincrement not null, "migration" varchar(255) not null, "batch" integer not null)');
    }
    protected static function files(): array { $f = glob(PG_ROOT . '/database/migrations/*.php') ?: []; sort($f); return $f; }
    protected static function resolve(string $file): object
    {
        $r = require $file;
        if (is_object($r)) return $r;
        $name = basename($file, '.php');
        $class = \Illuminate\Support\Str::studly(preg_replace('/^\d{4}_\d{2}_\d{2}_\d{6}_/', '', $name));
        if (!class_exists($class)) throw new \RuntimeException("Migration class [$class] not found in $name.php");
        return new $class;
    }

    public static function run(string $cmd, array $opts = []): int
    {
        self::$out = [];
        try {
            switch ($cmd) {
                case 'migrate': return self::migrate($opts);
                case 'migrate:fresh': return self::fresh($opts);
                case 'migrate:refresh': self::rollbackAll(); return self::migrate($opts) + (isset($opts['seed']) ? self::seed([]) : 0);
                case 'migrate:rollback': return self::rollback($opts);
                case 'migrate:reset': return self::rollbackAll();
                case 'migrate:status': return self::status();
                case 'db:seed': return self::seed($opts);
                case 'route:list': return self::routeList();
                case 'db:show': self::line('Tables: ' . implode(', ', self::conn()->getTables())); return 0;
                default: self::line("Command \"$cmd\" is not defined."); self::line('Available: migrate, migrate:fresh [--seed], migrate:rollback, migrate:status, db:seed [--class=X], route:list'); return 1;
            }
        } catch (\Throwable $e) {
            self::line();
            self::line('   ERROR  ' . get_class($e) . ': ' . $e->getMessage());
            self::line('   at ' . basename($e->getFile()) . ':' . $e->getLine());
            return 1;
        }
    }

    protected static function migrate(array $opts): int
    {
        self::ensureMigrationsTable();
        $ran = array_map(fn ($r) => $r['migration'], self::conn()->selectRows('select migration from migrations'));
        $pending = array_values(array_filter(self::files(), fn ($f) => !in_array(basename($f, '.php'), $ran, true)));
        if (!$pending) { self::line('   INFO  Nothing to migrate.'); return 0; }
        $batch = (int) self::conn()->scalar('select coalesce(max(batch), 0) from migrations') + 1;
        self::info('Running migrations.');
        foreach ($pending as $file) {
            $name = basename($file, '.php');
            $start = microtime(true);
            self::resolve($file)->up();
            self::conn()->insert('insert into migrations (migration, batch) values (?, ?)', [$name, $batch]);
            self::line(self::pad($name, round((microtime(true) - $start) * 1000) . 'ms DONE'));
        }
        self::line();
        return 0;
    }
    protected static function rollback(array $opts): int
    {
        self::ensureMigrationsTable();
        $batch = (int) self::conn()->scalar('select max(batch) from migrations');
        if (!$batch) { self::line('   INFO  Nothing to rollback.'); return 0; }
        $rows = self::conn()->selectRows('select migration from migrations where batch = ? order by id desc', [$batch]);
        self::info('Rolling back migrations.');
        foreach ($rows as $r) {
            $file = PG_ROOT . '/database/migrations/' . $r['migration'] . '.php';
            $start = microtime(true);
            if (is_file($file)) self::resolve($file)->down();
            self::conn()->delete('delete from migrations where migration = ?', [$r['migration']]);
            self::line(self::pad($r['migration'], round((microtime(true) - $start) * 1000) . 'ms DONE'));
        }
        self::line();
        return 0;
    }
    protected static function rollbackAll(): int { self::ensureMigrationsTable(); while ((int) self::conn()->scalar('select count(*) from migrations') > 0) self::rollback([]); return 0; }
    protected static function fresh(array $opts): int
    {
        $c = self::conn();
        $c->unprepared('PRAGMA foreign_keys = OFF');
        foreach ($c->getTables() as $t) $c->statement('drop table if exists "' . $t . '"');
        $c->unprepared('PRAGMA foreign_keys = ON');
        self::line('   INFO  Dropping all tables.'); self::line();
        $r = self::migrate($opts);
        if ($r === 0 && !empty($opts['seed'])) $r = self::seed($opts);
        return $r;
    }
    protected static function status(): int
    {
        self::ensureMigrationsTable();
        $ran = [];
        foreach (self::conn()->selectRows('select migration, batch from migrations') as $r) $ran[$r['migration']] = $r['batch'];
        self::line('  Migration name ......................................... Batch / Status');
        foreach (self::files() as $f) { $n = basename($f, '.php'); self::line(self::pad($n, isset($ran[$n]) ? '[' . $ran[$n] . '] Ran' : 'Pending')); }
        if (!self::files()) self::line('  (no migration files in database/migrations)');
        return 0;
    }
    protected static function seed(array $opts): int
    {
        $class = $opts['class'] ?? 'Database\\Seeders\\DatabaseSeeder';
        if (!str_contains($class, '\\')) $class = 'Database\\Seeders\\' . $class;
        if (!class_exists($class)) { self::line("   ERROR  Target class [$class] does not exist."); return 1; }
        self::info('Seeding database.');
        \Illuminate\Database\Seeder::$log = [];
        (new $class)->run();
        foreach (\Illuminate\Database\Seeder::$log as [$c, $ms]) self::line(self::pad($c, $ms . 'ms DONE'));
        self::line();
        return 0;
    }
    protected static function routeList(): int
    {
        Container::getInstance()->loadRoutes();
        $rows = [];
        foreach (Container::getInstance()->make('router')->routes as $r) {
            $methods = implode('|', array_diff($r->methods, ['HEAD']) ?: $r->methods);
            $a = $r->action;
            $action = $a instanceof \Closure ? 'Closure' : (is_array($a) ? class_basename($a[0]) . '@' . $a[1] : (string) $a);
            $rows[] = [$methods, ltrim($r->uri, '/') ?: '/', $r->name ?? '', $action];
        }
        foreach ($rows as [$m, $u, $n, $a]) self::line('  ' . str_pad($m, 16) . str_pad($u, 40) . str_pad($n, 24) . $a);
        self::line();
        self::line('  Showing [' . count($rows) . '] routes');
        return 0;
    }

    // Tinker: run PHP statements with the whole app loaded and show the value of the last expression like psysh does.
    public static function tinker(string $code): array
    {
        $code = trim($code);
        $uses = '';
        while (preg_match('/^use\s+[^;]+;\s*/', $code, $m)) { $uses .= $m[0]; $code = substr($code, strlen($m[0])); }
        $code = rtrim($code);
        $last = null;
        ob_start();
        try {
            $stmts = rtrim($code, ';');
            // evaluate everything but the last statement, then print the last one as an expression when it is one
            $pos = strrpos($stmts, ';');
            $head = $pos === false ? '' : substr($stmts, 0, $pos + 1);
            $tail = $pos === false ? $stmts : substr($stmts, $pos + 1);
            if (preg_match('/^\s*(return|echo|print|if|foreach|for|while|function|class|throw)\b/', $tail) || trim($tail) === '') { $result = eval($uses . $code); }
            else { $result = eval($uses . $head . ' return (' . trim($tail) . ');'); }
            $printed = ob_get_clean();
        } catch (\Throwable $e) {
            $printed = ob_get_clean();
            return ['output' => $printed . ($printed && !str_ends_with($printed, "\n") ? "\n" : '') . get_class($e) . ': ' . $e->getMessage() . ' at line ' . $e->getLine(), 'ok' => false];
        }
        $out = $printed;
        if ($out !== '' && !str_ends_with($out, "\n")) $out .= "\n";
        if (($result ?? null) !== null || trim($tail) !== '') $out .= '= ' . self::export($result ?? null);
        return ['output' => rtrim($out), 'ok' => true];
    }
    public static function export($v, int $depth = 0): string
    {
        if ($v instanceof \Illuminate\Database\Eloquent\Model || $v instanceof \Illuminate\Support\Collection || $v instanceof \JsonSerializable) return get_class($v) . ' ' . json_encode($v, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (is_array($v)) return json_encode($v, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (is_object($v) && !method_exists($v, '__toString')) return get_class($v) . ' ' . json_encode($v, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return var_export($v instanceof \Stringable ? (string) $v : $v, true);
    }
}

}

namespace {

use Illuminate\Container\Container;
use Illuminate\Foundation\DumpException;

if (!function_exists('app')) {
    function app($abstract = null, array $params = []) { $c = Container::getInstance(); return $abstract === null ? $c : $c->make($abstract, $params); }
    function request($key = null, $default = null) { $r = app('request'); return $key === null ? $r : $r->input($key, $default); }
    function response($content = null, int $status = 200, array $headers = [])
    {
        $f = new Illuminate\Http\ResponseFactory;
        return $content === null && func_num_args() === 0 ? $f : $f->make($content ?? '', $status, $headers);
    }
    function config($key = null, $default = null)
    {
        $c = Container::getInstance()->config;
        if ($key === null) return $c;
        if (is_array($key)) { foreach ($key as $k => $v) Illuminate\Support\Arr::set($c, $k, $v); Container::getInstance()->config = $c; return null; }
        return Illuminate\Support\Arr::get($c, $key, $default);
    }
    function env($key, $default = null)
    {
        $v = Container::getInstance()->env[$key] ?? null;
        if ($v === null) return value($default);
        return match (strtolower($v)) { 'true', '(true)' => true, 'false', '(false)' => false, 'null', '(null)' => null, 'empty', '(empty)' => '', default => $v };
    }
    function abort(int $code, string $message = '', array $headers = []): never { throw new Symfony\Component\HttpKernel\Exception\HttpException($code, $message, null, $headers); }
    function abort_if($cond, int $code, string $message = ''): void { if ($cond) abort($code, $message); }
    function abort_unless($cond, int $code, string $message = ''): void { if (!$cond) abort($code, $message); }
    function validator(array $data = [], array $rules = [], array $messages = []) { return Illuminate\Validation\Validator::make($data, $rules, $messages); }
    function fake() { static $g; return $g ??= new Faker\Generator(42); }
    function dump(...$vars) { foreach ($vars as $v) Container::getInstance()->debug['dumps'][] = Illuminate\Console\Artisan::export($v); return $vars[0] ?? null; }
    function dd(...$vars): never { throw new DumpException(implode("\n", array_map(fn ($v) => Illuminate\Console\Artisan::export($v), $vars))); }
    function logger($message = null, array $context = []) { if ($message !== null) Illuminate\Support\Facades\Log::info($message, $context); }
    function info($message, array $context = []) { Illuminate\Support\Facades\Log::info($message, $context); }
    function route($name, $params = []) { foreach (app('router')->routes as $r) if ($r->name === $name) { $u = $r->uri; foreach ((array) $params as $k => $v) $u = str_replace('{' . $k . '}', $v, $u); return 'http://localhost:8000' . $u; } throw new InvalidArgumentException("Route [$name] not defined."); }
    function url($path = '') { return 'http://localhost:8000/' . ltrim($path, '/'); }
    function base_path($p = '') { return '/' . ltrim($p, '/'); }
    function storage_path($p = '') { return '/tmp/' . ltrim($p, '/'); }
    function __($key, $replace = []) { return strtr($key, array_combine(array_map(fn ($k) => ':' . $k, array_keys($replace)), array_values($replace)) ?: []); }
    function resource_path($p = '') { return '/resources/' . ltrim($p, '/'); }
}

// Real Laravel makes the common classes available from the global namespace too (config/app.php aliases).
foreach ([
    'Route' => Illuminate\Support\Facades\Route::class, 'DB' => Illuminate\Support\Facades\DB::class, 'Schema' => Illuminate\Support\Facades\Schema::class,
    'Validator' => Illuminate\Support\Facades\Validator::class, 'Hash' => Illuminate\Support\Facades\Hash::class, 'Log' => Illuminate\Support\Facades\Log::class,
    'Cache' => Illuminate\Support\Facades\Cache::class, 'Auth' => Illuminate\Support\Facades\Auth::class, 'Str' => Illuminate\Support\Str::class, 'Arr' => Illuminate\Support\Arr::class,
    'Carbon' => Illuminate\Support\Carbon::class, 'Collection' => Illuminate\Support\Collection::class, 'Request' => Illuminate\Http\Request::class,
] as $alias => $class) if (!class_exists($alias, false)) class_alias($class, $alias);
class_alias(Illuminate\Support\Carbon::class, 'Carbon\\Carbon');
}
