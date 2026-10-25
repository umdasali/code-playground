<?php
// Laravel-style mini framework: container, HTTP request/response, validation and the HTTP exceptions.

namespace Illuminate\Container {

use Closure;
use ReflectionClass;
use ReflectionFunction;
use ReflectionFunctionAbstract;
use ReflectionMethod;
use ReflectionNamedType;

class Container
{
    protected static ?Container $instance = null;
    protected array $bindings = [];
    protected array $instances = [];

    public static function getInstance(): static { return static::$instance ??= new static; }
    public static function setInstance(?Container $c): void { static::$instance = $c; }

    public function bind($abstract, $concrete = null, bool $shared = false): void { $this->bindings[$abstract] = [$concrete ?? $abstract, $shared]; }
    public function singleton($abstract, $concrete = null): void { $this->bind($abstract, $concrete, true); }
    public function instance($abstract, $obj) { return $this->instances[$abstract] = $obj; }
    public function bound($abstract): bool { return isset($this->bindings[$abstract]) || isset($this->instances[$abstract]); }

    public function make($abstract, array $params = [])
    {
        if (isset($this->instances[$abstract])) return $this->instances[$abstract];
        $shared = false;
        if (isset($this->bindings[$abstract])) {
            [$concrete, $shared] = $this->bindings[$abstract];
            $obj = $concrete instanceof Closure ? $concrete($this, $params) : ($concrete === $abstract ? $this->build($abstract, $params) : $this->make($concrete, $params));
        } else {
            $obj = $this->build($abstract, $params);
        }
        if ($shared) $this->instances[$abstract] = $obj;
        return $obj;
    }

    protected function build(string $class, array $params)
    {
        if (!class_exists($class)) throw new \RuntimeException("Target class [$class] does not exist.");
        if (is_subclass_of($class, \Illuminate\Foundation\Http\FormRequest::class) && isset($this->instances['request'])) {
            $req = $class::createFrom($this->instances['request']);
            $req->validateResolved();
            return $req;
        }
        $ref = new ReflectionClass($class);
        if (!$ref->isInstantiable()) throw new \RuntimeException("Target [$class] is not instantiable.");
        $ctor = $ref->getConstructor();
        if (!$ctor) return new $class;
        return $ref->newInstanceArgs($this->resolveParameters($ctor, $params));
    }

    // Call a closure, [class, method] pair, "Class@method" string or invokable object, injecting type-hinted classes and route parameters.
    public function call($callback, array $params = [])
    {
        if (is_string($callback) && str_contains($callback, '@')) $callback = explode('@', $callback, 2);
        if (is_array($callback)) {
            [$target, $method] = $callback;
            if (is_string($target)) $target = $this->make($target);
            $ref = new ReflectionMethod($target, $method);
            return $ref->invokeArgs($target, $this->resolveParameters($ref, $params));
        }
        if (is_object($callback) && !($callback instanceof Closure)) {
            $ref = new ReflectionMethod($callback, '__invoke');
            return $ref->invokeArgs($callback, $this->resolveParameters($ref, $params));
        }
        $ref = new ReflectionFunction($callback);
        return $ref->invokeArgs($this->resolveParameters($ref, $params));
    }

    protected function resolveParameters(ReflectionFunctionAbstract $fn, array $params): array
    {
        $out = [];
        foreach ($fn->getParameters() as $p) {
            $name = $p->getName();
            $type = $p->getType();
            $class = $type instanceof ReflectionNamedType && !$type->isBuiltin() ? $type->getName() : null;
            if ($class !== null) {
                if (array_key_exists($name, $params) && is_a($class, \Illuminate\Database\Eloquent\Model::class, true) && !($params[$name] instanceof $class)) {
                    $out[] = (new $class)->resolveRouteBinding($params[$name]);
                } elseif (array_key_exists($name, $params) && $params[$name] instanceof $class) {
                    $out[] = $params[$name];
                } else {
                    $out[] = $this->make($class);
                }
            } elseif (array_key_exists($name, $params)) {
                $v = $params[$name];
                if ($type instanceof ReflectionNamedType && is_string($v)) {
                    if ($type->getName() === 'int' && is_numeric($v)) $v = (int) $v;
                    elseif ($type->getName() === 'float' && is_numeric($v)) $v = (float) $v;
                    elseif ($type->getName() === 'bool') $v = filter_var($v, FILTER_VALIDATE_BOOLEAN);
                }
                $out[] = $v;
            } elseif ($p->isDefaultValueAvailable()) {
                $out[] = $p->getDefaultValue();
            } elseif ($type && $type->allowsNull()) {
                $out[] = null;
            } else {
                throw new \RuntimeException("Unresolvable dependency resolving [Parameter #{$p->getPosition()} [ \${$name} ]] in " . ($fn instanceof ReflectionMethod ? $fn->class . '::' : '') . $fn->getName());
            }
        }
        return $out;
    }
}

}

namespace Symfony\Component\HttpFoundation {

class Response
{
    const HTTP_OK = 200; const HTTP_CREATED = 201; const HTTP_ACCEPTED = 202; const HTTP_NO_CONTENT = 204;
    const HTTP_MOVED_PERMANENTLY = 301; const HTTP_FOUND = 302; const HTTP_NOT_MODIFIED = 304;
    const HTTP_BAD_REQUEST = 400; const HTTP_UNAUTHORIZED = 401; const HTTP_FORBIDDEN = 403; const HTTP_NOT_FOUND = 404;
    const HTTP_METHOD_NOT_ALLOWED = 405; const HTTP_CONFLICT = 409; const HTTP_GONE = 410; const HTTP_UNPROCESSABLE_ENTITY = 422;
    const HTTP_TOO_MANY_REQUESTS = 429; const HTTP_INTERNAL_SERVER_ERROR = 500; const HTTP_SERVICE_UNAVAILABLE = 503;

    protected $content;
    protected int $status;
    protected array $headers = [];

    public function __construct($content = '', int $status = 200, array $headers = [])
    {
        $this->content = $content; $this->status = $status; $this->headers = $headers;
    }
    public function getContent() { return $this->content; }
    public function setContent($c): static { $this->content = $c; return $this; }
    public function getStatusCode(): int { return $this->status; }
    public function setStatusCode(int $s): static { $this->status = $s; return $this; }
    public function status(): int { return $this->status; }
    public function header($k, $v): static { $this->headers[$k] = $v; return $this; }
    public function withHeaders(array $h): static { foreach ($h as $k => $v) $this->headers[$k] = $v; return $this; }
    public function getHeaders(): array { return $this->headers; }
}

}

namespace Symfony\Component\HttpKernel\Exception {

class HttpException extends \RuntimeException
{
    public function __construct(protected int $statusCode, string $message = '', ?\Throwable $previous = null, protected array $headers = [])
    {
        parent::__construct($message, 0, $previous);
    }
    public function getStatusCode(): int { return $this->statusCode; }
    public function getHeaders(): array { return $this->headers; }
}
class NotFoundHttpException extends HttpException { public function __construct(string $message = '', ?\Throwable $p = null) { parent::__construct(404, $message, $p); } }
class MethodNotAllowedHttpException extends HttpException
{
    public function __construct(array $allow, string $message = '', ?\Throwable $p = null) { parent::__construct(405, $message, $p, ['Allow' => implode(', ', $allow)]); }
}
class AccessDeniedHttpException extends HttpException { public function __construct(string $message = '', ?\Throwable $p = null) { parent::__construct(403, $message, $p); } }
class BadRequestHttpException extends HttpException { public function __construct(string $message = '', ?\Throwable $p = null) { parent::__construct(400, $message, $p); } }
class ConflictHttpException extends HttpException { public function __construct(string $message = '', ?\Throwable $p = null) { parent::__construct(409, $message, $p); } }

}

namespace Illuminate\Auth {
class AuthenticationException extends \RuntimeException { public function __construct(string $m = 'Unauthenticated.') { parent::__construct($m); } }
}

namespace Illuminate\Http {

use Illuminate\Support\Arr;
use Illuminate\Support\Collection;
use Illuminate\Contracts\Support\Arrayable;
use Symfony\Component\HttpFoundation\Response as BaseResponse;

class JsonResponse extends BaseResponse
{
    public function __construct($data = null, int $status = 200, array $headers = [], int $options = 0)
    {
        parent::__construct($data, $status, $headers + ['Content-Type' => 'application/json']);
        $this->options = $options;
    }
    protected int $options = 0;
    public function getData(bool $assoc = false) { return json_decode($this->getContent(), $assoc); }
    public function getContent() { return is_string($this->content) ? $this->content : json_encode($this->content, $this->options | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION); }
}

class Response extends BaseResponse {}

class ResponseFactory
{
    public function make($content = '', int $status = 200, array $headers = []): Response { return new Response($content, $status, $headers); }
    public function json($data = [], int $status = 200, array $headers = [], int $options = 0): JsonResponse { return new JsonResponse($data, $status, $headers, $options); }
    public function noContent(int $status = 204, array $headers = []): Response { return new Response('', $status, $headers); }
}

class Request implements \ArrayAccess, \JsonSerializable
{
    public array $query = [];
    public array $request = [];
    public array $headers = [];
    protected array $routeParams = [];
    protected string $method = 'GET';
    protected string $path = '/';
    protected string $rawBody = '';
    protected $routeObject = null;

    public static function create(string $method, string $uri, array $headers = [], string $body = ''): static
    {
        $r = new static;
        $parts = parse_url($uri) ?: ['path' => '/'];
        $r->method = strtoupper($method);
        $r->path = '/' . ltrim($parts['path'] ?? '/', '/');
        parse_str($parts['query'] ?? '', $r->query);
        foreach ($headers as $k => $v) $r->headers[strtolower($k)] = $v;
        $r->rawBody = $body;
        $type = $r->headers['content-type'] ?? '';
        if ($body !== '') {
            if (str_contains($type, 'json') || (!str_contains($type, 'form') && in_array($body[0], ['{', '[']))) {
                $d = json_decode($body, true);
                $r->request = is_array($d) ? $d : [];
            } else {
                parse_str($body, $r->request);
            }
        }
        return $r;
    }
    public static function createFrom(Request $from): static
    {
        $r = new static;
        foreach (get_object_vars($from) as $k => $v) $r->$k = $v;
        return $r;
    }

    public function method(): string { return $this->method; }
    public function isMethod(string $m): bool { return strtoupper($m) === $this->method; }
    public function path(): string { $p = trim($this->path, '/'); return $p === '' ? '/' : $p; }
    public function url(): string { return 'http://localhost:8000' . ($this->path === '/' ? '' : $this->path); }
    public function fullUrl(): string { return $this->url() . ($this->query ? '?' . http_build_query($this->query) : ''); }
    public function segments(): array { return array_values(array_filter(explode('/', $this->path))); }
    public function segment(int $i, $default = null) { return $this->segments()[$i - 1] ?? $default; }
    public function is(...$patterns): bool { foreach ($patterns as $p) if (\Illuminate\Support\Str::is($p, $this->path())) return true; return false; }
    public function header($key = null, $default = null) { return $key === null ? $this->headers : ($this->headers[strtolower($key)] ?? $default); }
    public function bearerToken(): ?string { $h = $this->header('authorization', ''); return str_starts_with($h, 'Bearer ') ? substr($h, 7) : null; }
    public function ip(): string { return '127.0.0.1'; }
    public function userAgent(): ?string { return $this->header('user-agent'); }
    public function expectsJson(): bool { return true; }
    public function wantsJson(): bool { return true; }
    public function ajax(): bool { return true; }
    public function user() { return null; }
    public function getContent(): string { return $this->rawBody; }
    public function json($key = null, $default = null) { $d = json_decode($this->rawBody, true) ?? []; return $key === null ? new Collection($d) : Arr::get($d, $key, $default); }

    public function all($keys = null): array { $a = $this->request + $this->query + $this->routeParams; return $keys ? Arr::only($a, (array) $keys) : $a; }
    public function input($key = null, $default = null) { return $key === null ? $this->all() : Arr::get($this->all(), $key, $default); }
    public function query($key = null, $default = null) { return $key === null ? $this->query : Arr::get($this->query, $key, $default); }
    public function post($key = null, $default = null) { return $key === null ? $this->request : Arr::get($this->request, $key, $default); }
    public function only(...$keys): array { return Arr::only($this->all(), is_array($keys[0] ?? null) ? $keys[0] : $keys); }
    public function except(...$keys): array { return Arr::except($this->all(), is_array($keys[0] ?? null) ? $keys[0] : $keys); }
    public function has($keys): bool { return Arr::has($this->all(), $keys); }
    public function hasAny(array $keys): bool { foreach ($keys as $k) if ($this->has($k)) return true; return false; }
    public function filled($keys): bool { foreach ((array) $keys as $k) if (blank($this->input($k))) return false; return true; }
    public function missing($key): bool { return !$this->has($key); }
    public function boolean($key, $default = false): bool { return filter_var($this->input($key, $default), FILTER_VALIDATE_BOOLEAN); }
    public function integer($key, $default = 0): int { return (int) $this->input($key, $default); }
    public function float($key, $default = 0.0): float { return (float) $this->input($key, $default); }
    public function string($key, $default = '') { return (string) $this->input($key, $default); }
    public function collect($key = null): Collection { return new Collection($key === null ? $this->all() : $this->input($key, [])); }
    public function merge(array $a): static { $this->request = $a + $this->request; return $this; }
    public function replace(array $a): static { $this->request = $a; return $this; }
    public function setRouteParams(array $p, $route = null): void { $this->routeParams = $p; $this->routeObject = $route; }
    public function route($key = null, $default = null) { return $key === null ? $this->routeParams : ($this->routeParams[$key] ?? $default); }

    public function validate(array $rules, array $messages = [], array $attributes = []): array
    {
        return \Illuminate\Validation\Validator::make($this->all(), $rules, $messages, $attributes)->validate();
    }

    public function __get($k) { return $this->input($k); }
    public function __isset($k): bool { return $this->has($k); }
    public function offsetExists(mixed $k): bool { return $this->has($k); }
    public function offsetGet(mixed $k): mixed { return $this->input($k); }
    public function offsetSet(mixed $k, mixed $v): void { $this->request[$k] = $v; }
    public function offsetUnset(mixed $k): void { unset($this->request[$k]); }
    public function jsonSerialize(): array { return $this->all(); }
}

}

namespace Illuminate\Foundation\Http {

use Illuminate\Http\Request;
use Illuminate\Validation\Validator;
use Illuminate\Validation\ValidationException;

// A request class with its own rules(): it validates itself when the controller asks for it.
class FormRequest extends Request
{
    protected ?array $validatedData = null;

    public function authorize(): bool { return true; }
    public function rules(): array { return []; }
    public function messages(): array { return []; }
    public function attributes(): array { return []; }

    public function validateResolved(): void
    {
        if (method_exists($this, 'prepareForValidation')) $this->prepareForValidation();
        if (!$this->authorize()) throw new \Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException('This action is unauthorized.');
        $v = Validator::make($this->all(), $this->rules(), $this->messages(), $this->attributes());
        if (method_exists($this, 'withValidator')) $this->withValidator($v);
        $this->validatedData = $v->validate();
    }
    public function validated($key = null, $default = null) { return $key === null ? $this->validatedData : \Illuminate\Support\Arr::get($this->validatedData, $key, $default); }
    public function safe(): \Illuminate\Support\Collection { return new \Illuminate\Support\Collection($this->validatedData); }
}

}

namespace Illuminate\Validation {

use Illuminate\Support\Arr;
use Illuminate\Support\Str;

class MessageBag implements \JsonSerializable, \Countable
{
    public function __construct(protected array $messages = []) {}
    public function add($key, $message): static { $this->messages[$key][] = $message; return $this; }
    public function get($key): array { return $this->messages[$key] ?? []; }
    public function first($key = null) { if ($key === null) { foreach ($this->messages as $m) return $m[0]; return ''; } return $this->messages[$key][0] ?? ''; }
    public function has($key): bool { return isset($this->messages[$key]); }
    public function all(): array { return array_merge(...array_values($this->messages ?: [[]])); }
    public function keys(): array { return array_keys($this->messages); }
    public function isEmpty(): bool { return empty($this->messages); }
    public function isNotEmpty(): bool { return !empty($this->messages); }
    public function count(): int { return count($this->all()); }
    public function toArray(): array { return $this->messages; }
    public function jsonSerialize(): array { return $this->messages; }
}

class ValidationException extends \RuntimeException
{
    public int $status = 422;
    public function __construct(public Validator|MessageBag|null $validator, public array $messagesArray = [])
    {
        $bag = $validator instanceof Validator ? $validator->errors() : ($validator ?? new MessageBag($messagesArray));
        $this->bag = $bag;
        $all = $bag->all();
        $msg = $all[0] ?? 'The given data was invalid.';
        if (count($all) > 1) $msg .= ' (and ' . (count($all) - 1) . ' more error' . (count($all) > 2 ? 's' : '') . ')';
        parent::__construct($msg);
    }
    public MessageBag $bag;
    public static function withMessages(array $messages): static { return new static(null, array_map(fn ($m) => (array) $m, $messages)); }
    public function errors(): array { return $this->bag->toArray(); }
}

class Rule
{
    public static function in(array $v): string { return 'in:' . implode(',', $v); }
    public static function notIn(array $v): string { return 'not_in:' . implode(',', $v); }
    public static function unique(string $table, string $column = 'NULL'): UniqueRule { return new UniqueRule($table, $column); }
    public static function exists(string $table, string $column = 'NULL'): string { return 'exists:' . $table . ',' . $column; }
    public static function requiredIf(callable|bool $c): string { return value($c) ? 'required' : ''; }
}
class UniqueRule
{
    protected $ignoreId = null; protected string $idColumn = 'id';
    public function __construct(protected string $table, protected string $column) {}
    public function ignore($id, string $idColumn = 'id'): static { $this->ignoreId = $id instanceof \Illuminate\Database\Eloquent\Model ? $id->getKey() : $id; $this->idColumn = $idColumn; return $this; }
    public function __toString(): string { return 'unique:' . $this->table . ',' . $this->column . ($this->ignoreId !== null ? ',' . $this->ignoreId . ',' . $this->idColumn : ''); }
}

class Validator
{
    protected array $errorsList = [];
    protected bool $ran = false;
    protected array $failedRules = [];
    protected array $afterCallbacks = [];

    public function __construct(protected array $data, protected array $rules, protected array $customMessages = [], protected array $customAttributes = []) {}
    public static function make(array $data, array $rules, array $messages = [], array $attributes = []): static { return new static($data, $rules, $messages, $attributes); }

    public function after(callable $cb): static { $this->afterCallbacks[] = $cb; return $this; }
    public function errors(): MessageBag { $this->run(); return new MessageBag($this->errorsList); }
    public function fails(): bool { $this->run(); return !empty($this->errorsList); }
    public function passes(): bool { return !$this->fails(); }
    public function failed(): array { $this->run(); return $this->failedRules; }

    public function validate(): array
    {
        if ($this->fails()) throw new ValidationException($this);
        return $this->validated();
    }
    public function validated(): array
    {
        $this->run();
        $out = [];
        foreach (array_keys($this->rules) as $key) {
            foreach ($this->expand($key) as $k) if (Arr::has($this->data, $k)) Arr::set($out, $k, Arr::get($this->data, $k));
        }
        return $out;
    }
    public function sometimes($attr, $rules, callable $cb): static { if ($cb(new \Illuminate\Support\Collection($this->data))) $this->rules[$attr] = $rules; return $this; }

    protected function expand(string $key): array
    {
        if (!str_contains($key, '*')) return [$key];
        $paths = [''];
        foreach (explode('.', $key) as $seg) {
            $next = [];
            foreach ($paths as $p) {
                if ($seg === '*') {
                    $arr = $p === '' ? $this->data : Arr::get($this->data, $p);
                    if (is_array($arr)) foreach (array_keys($arr) as $i) $next[] = ($p === '' ? '' : $p . '.') . $i;
                } else $next[] = ($p === '' ? '' : $p . '.') . $seg;
            }
            $paths = $next;
        }
        return $paths ?: [];
    }

    protected function run(): void
    {
        if ($this->ran) return;
        $this->ran = true;
        foreach ($this->rules as $key => $ruleSet) {
            $list = is_array($ruleSet) ? $ruleSet : explode('|', (string) $ruleSet);
            $list = array_values(array_filter(array_map(fn ($r) => is_object($r) ? (string) $r : $r, $list), fn ($r) => $r !== '' && $r !== null));
            foreach ($this->expand($key) as $attr) $this->validateAttribute($attr, $list, $key);
        }
        foreach ($this->afterCallbacks as $cb) $cb($this);
    }

    public function addError(string $attr, string $message): void { $this->errorsList[$attr][] = $message; }

    protected function validateAttribute(string $attr, array $rules, string $ruleKey): void
    {
        $has = Arr::has($this->data, $attr);
        $value = Arr::get($this->data, $attr);
        $names = array_map(fn ($r) => is_string($r) ? strtolower(explode(':', $r, 2)[0]) : '', $rules);
        if (in_array('sometimes', $names, true) && !$has) return;
        $nullable = in_array('nullable', $names, true);
        $bail = in_array('bail', $names, true);
        $empty = !$has || $value === null || (is_string($value) && trim($value) === '') || $value === [];
        $numeric = in_array('numeric', $names, true) || in_array('integer', $names, true) || in_array('decimal', $names, true);

        foreach ($rules as $rule) {
            if (!is_string($rule)) continue;
            [$name, $arg] = array_pad(explode(':', $rule, 2), 2, null);
            $name = strtolower($name);
            if (in_array($name, ['nullable', 'sometimes', 'bail'], true)) continue;
            $params = $arg === null ? [] : ($name === 'regex' ? [$arg] : explode(',', $arg));
            $implicit = in_array($name, ['required', 'filled', 'accepted', 'present', 'required_if', 'required_with'], true);
            if ($empty && !$implicit) continue;
            if ($value === null && $nullable && !$implicit) continue;
            $ok = $this->check($name, $attr, $value, $params, $has);
            if ($ok !== true) {
                $this->failedRules[$attr][ucfirst($name)] = $params;
                $this->errorsList[$attr][] = $this->message($name, $attr, $value, $params, $numeric, $ruleKey);
                if ($bail) break;
            }
        }
    }

    protected function size($value, bool $numeric)
    {
        if ($numeric && is_numeric($value)) return $value + 0;
        if (is_array($value)) return count($value);
        return mb_strlen((string) $value);
    }

    protected function check(string $name, string $attr, $value, array $p, bool $has): bool
    {
        switch ($name) {
            case 'required': return $has && $value !== null && !(is_string($value) && trim($value) === '') && $value !== [];
            case 'filled': return !$has || !($value === null || (is_string($value) && trim($value) === ''));
            case 'present': return $has;
            case 'accepted': return in_array($value, ['yes', 'on', 1, '1', true, 'true'], true);
            case 'string': return is_string($value);
            case 'integer': return is_int($value) || (is_string($value) && preg_match('/^-?\d+$/', $value));
            case 'numeric': return is_numeric($value) && !is_string($value) || (is_string($value) && is_numeric($value));
            case 'decimal': return is_numeric($value);
            case 'boolean': return in_array($value, [true, false, 0, 1, '0', '1'], true);
            case 'array': return is_array($value);
            case 'email': return is_string($value) && filter_var($value, FILTER_VALIDATE_EMAIL) !== false;
            case 'url': return is_string($value) && filter_var($value, FILTER_VALIDATE_URL) !== false;
            case 'ip': return filter_var($value, FILTER_VALIDATE_IP) !== false;
            case 'uuid': return is_string($value) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value);
            case 'json': return is_string($value) && json_decode($value) !== null;
            case 'date': return is_string($value) && strtotime($value) !== false;
            case 'date_format': return \DateTime::createFromFormat($p[0], (string) $value) !== false;
            case 'alpha': return is_string($value) && preg_match('/^[\pL\pM]+$/u', $value);
            case 'alpha_num': return is_string($value) && preg_match('/^[\pL\pM\pN]+$/u', $value);
            case 'alpha_dash': return is_string($value) && preg_match('/^[\pL\pM\pN_-]+$/u', $value);
            case 'min': return $this->size($value, $this->isNumericAttr($attr)) >= $p[0];
            case 'max': return $this->size($value, $this->isNumericAttr($attr)) <= $p[0];
            case 'size': return $this->size($value, $this->isNumericAttr($attr)) == $p[0];
            case 'between': return ($s = $this->size($value, $this->isNumericAttr($attr))) >= $p[0] && $s <= $p[1];
            case 'digits': return preg_match('/^\d{' . (int) $p[0] . '}$/', (string) $value) === 1;
            case 'gt': return is_numeric($value) && $value > (is_numeric($p[0]) ? $p[0] : Arr::get($this->data, $p[0]));
            case 'gte': return is_numeric($value) && $value >= (is_numeric($p[0]) ? $p[0] : Arr::get($this->data, $p[0]));
            case 'lt': return is_numeric($value) && $value < (is_numeric($p[0]) ? $p[0] : Arr::get($this->data, $p[0]));
            case 'lte': return is_numeric($value) && $value <= (is_numeric($p[0]) ? $p[0] : Arr::get($this->data, $p[0]));
            case 'in': return in_array((string) $value, $p, true) || (is_bool($value) && in_array($value ? '1' : '0', $p, true));
            case 'not_in': return !in_array((string) $value, $p, true);
            case 'regex': return @preg_match($p[0], (string) $value) === 1;
            case 'starts_with': foreach ($p as $x) if (str_starts_with((string) $value, $x)) return true; return false;
            case 'ends_with': foreach ($p as $x) if (str_ends_with((string) $value, $x)) return true; return false;
            case 'confirmed': return $value === Arr::get($this->data, $attr . '_confirmation');
            case 'same': return $value === Arr::get($this->data, $p[0]);
            case 'different': return $value !== Arr::get($this->data, $p[0]);
            case 'after': return strtotime((string) $value) > strtotime(Arr::get($this->data, $p[0], $p[0]) ?? $p[0]);
            case 'before': return strtotime((string) $value) < strtotime(Arr::get($this->data, $p[0], $p[0]) ?? $p[0]);
            case 'required_if': return Arr::get($this->data, $p[0]) != ($p[1] ?? null) || $this->check('required', $attr, $value, [], $has);
            case 'required_with': foreach ($p as $o) if (Arr::has($this->data, $o) && filled(Arr::get($this->data, $o))) return $this->check('required', $attr, $value, [], $has); return true;
            case 'unique': {
                $col = isset($p[1]) && $p[1] !== 'NULL' ? $p[1] : preg_replace('/^.*\./', '', $attr);
                $q = \Illuminate\Support\Facades\DB::table($p[0])->where($col, $value);
                if (isset($p[2]) && $p[2] !== '') $q->where($p[3] ?? 'id', '!=', $p[2]);
                return $q->count() === 0;
            }
            case 'exists': {
                $col = isset($p[1]) && $p[1] !== 'NULL' ? $p[1] : preg_replace('/^.*\./', '', $attr);
                return \Illuminate\Support\Facades\DB::table($p[0])->where($col, $value)->count() > 0;
            }
        }
        return true; // unknown rules are ignored
    }

    protected array $numericAttrs = [];
    protected function isNumericAttr(string $attr): bool
    {
        foreach ($this->rules as $k => $set) {
            if (preg_replace('/\.\d+/', '.*', $attr) !== $k && $attr !== $k) continue;
            $s = is_array($set) ? implode('|', array_map(fn ($r) => is_string($r) ? $r : '', $set)) : $set;
            return (bool) preg_match('/(^|\|)(numeric|integer|decimal)(\||:|$)/', $s);
        }
        return false;
    }

    protected function message(string $rule, string $attr, $value, array $p, bool $numeric, string $ruleKey): string
    {
        foreach ([$attr . '.' . $rule, $ruleKey . '.' . $rule, $rule] as $k) {
            if (isset($this->customMessages[$k])) return $this->fill($this->customMessages[$k], $attr, $p);
        }
        $a = ':attribute';
        $kind = $numeric ? 'numeric' : (is_array($value) ? 'array' : 'string');
        $text = match ($rule) {
            'required', 'filled', 'present' => "The $a field is required.",
            'accepted' => "The $a field must be accepted.",
            'string' => "The $a field must be a string.",
            'integer' => "The $a field must be an integer.",
            'numeric', 'decimal' => "The $a field must be a number.",
            'boolean' => "The $a field must be true or false.",
            'array' => "The $a field must be an array.",
            'email' => "The $a field must be a valid email address.",
            'url' => "The $a field must be a valid URL.",
            'ip' => "The $a field must be a valid IP address.",
            'uuid' => "The $a field must be a valid UUID.",
            'json' => "The $a field must be a valid JSON string.",
            'date' => "The $a field must be a valid date.",
            'date_format' => "The $a field must match the format :format.",
            'alpha' => "The $a field must only contain letters.",
            'alpha_num' => "The $a field must only contain letters and numbers.",
            'alpha_dash' => "The $a field must only contain letters, numbers, dashes, and underscores.",
            'min' => match ($kind) { 'numeric' => "The $a field must be at least :min.", 'array' => "The $a field must have at least :min items.", default => "The $a field must be at least :min characters." },
            'max' => match ($kind) { 'numeric' => "The $a field must not be greater than :max.", 'array' => "The $a field must not have more than :max items.", default => "The $a field must not be greater than :max characters." },
            'size' => match ($kind) { 'numeric' => "The $a field must be :size.", 'array' => "The $a field must contain :size items.", default => "The $a field must be :size characters." },
            'between' => match ($kind) { 'numeric' => "The $a field must be between :min and :max.", 'array' => "The $a field must have between :min and :max items.", default => "The $a field must be between :min and :max characters." },
            'digits' => "The $a field must be :digits digits.",
            'gt' => "The $a field must be greater than :value.", 'gte' => "The $a field must be greater than or equal to :value.",
            'lt' => "The $a field must be less than :value.", 'lte' => "The $a field must be less than or equal to :value.",
            'in', 'not_in', 'exists' => "The selected $a is invalid.",
            'regex' => "The $a field format is invalid.",
            'starts_with' => "The $a field must start with one of the following: :values.",
            'ends_with' => "The $a field must end with one of the following: :values.",
            'confirmed' => "The $a field confirmation does not match.",
            'same' => "The $a field and :other must match.",
            'different' => "The $a field and :other must be different.",
            'after' => "The $a field must be a date after :date.", 'before' => "The $a field must be a date before :date.",
            'unique' => "The $a has already been taken.",
            'required_if', 'required_with' => "The $a field is required.",
            default => "The $a field is invalid.",
        };
        return $this->fill($text, $attr, $p);
    }

    protected function fill(string $text, string $attr, array $p): string
    {
        $name = $this->customAttributes[$attr] ?? str_replace('_', ' ', preg_replace('/\.\d+\./', ' ', $attr));
        return strtr($text, [':attribute' => $name, ':min' => $p[0] ?? '', ':max' => $p[1] ?? $p[0] ?? '', ':size' => $p[0] ?? '', ':digits' => $p[0] ?? '', ':value' => $p[0] ?? '', ':other' => $p[0] ?? '', ':date' => $p[0] ?? '', ':format' => $p[0] ?? '', ':values' => implode(', ', $p)]);
    }
}

}
