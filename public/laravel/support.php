<?php
// Laravel-style mini framework for the Coding Playground: support classes (Collection, Arr, Str, Carbon) and global helpers.
// The namespaces and method names follow Laravel, so code written here reads like a real Laravel project.

namespace Illuminate\Contracts\Support {
    interface Arrayable { public function toArray(); }
    interface Jsonable { public function toJson($options = 0); }
}

namespace Illuminate\Support {

use ArrayAccess;
use Countable;
use IteratorAggregate;
use JsonSerializable;
use Illuminate\Contracts\Support\Arrayable;

class Arr
{
    public static function get($array, $key, $default = null)
    {
        if ($key === null) return $array;
        if (is_array($array) && array_key_exists($key, $array)) return $array[$key];
        foreach (explode('.', (string) $key) as $part) {
            if (is_array($array) && array_key_exists($part, $array)) $array = $array[$part];
            elseif ($array instanceof ArrayAccess && isset($array[$part])) $array = $array[$part];
            elseif (is_object($array) && isset($array->$part)) $array = $array->$part;
            else return $default instanceof \Closure ? $default() : $default;
        }
        return $array;
    }
    public static function set(&$array, $key, $value)
    {
        $parts = explode('.', $key);
        foreach ($parts as $i => $part) {
            if ($i === count($parts) - 1) { $array[$part] = $value; break; }
            if (!isset($array[$part]) || !is_array($array[$part])) $array[$part] = [];
            $array = &$array[$part];
        }
        return $array;
    }
    public static function has($array, $keys): bool
    {
        foreach ((array) $keys as $key) {
            $sub = $array;
            foreach (explode('.', $key) as $part) {
                if (is_array($sub) && array_key_exists($part, $sub)) $sub = $sub[$part]; else return false;
            }
        }
        return true;
    }
    public static function only($array, $keys): array { return array_intersect_key($array, array_flip((array) $keys)); }
    public static function except($array, $keys): array { return array_diff_key($array, array_flip((array) $keys)); }
    public static function first($array, ?callable $cb = null, $default = null)
    {
        foreach ($array as $k => $v) if ($cb === null || $cb($v, $k)) return $v;
        return $default;
    }
    public static function last($array, ?callable $cb = null, $default = null) { return self::first(array_reverse($array, true), $cb, $default); }
    public static function wrap($v): array { return $v === null ? [] : (is_array($v) ? $v : [$v]); }
    public static function pluck($array, $value, $key = null): array
    {
        $out = [];
        foreach ($array as $item) {
            $v = data_get($item, $value);
            if ($key === null) $out[] = $v; else $out[data_get($item, $key)] = $v;
        }
        return $out;
    }
    public static function flatten($array, $depth = INF): array
    {
        $out = [];
        foreach ($array as $item) {
            if ($item instanceof Collection) $item = $item->all();
            if (!is_array($item)) $out[] = $item;
            elseif ($depth === 1) $out = array_merge($out, array_values($item));
            else $out = array_merge($out, self::flatten($item, $depth - 1));
        }
        return $out;
    }
    public static function isAssoc(array $a): bool { return $a !== [] && array_keys($a) !== range(0, count($a) - 1); }
    public static function shuffle(array $a): array { shuffle($a); return $a; }
    public static function random(array $a) { return $a[array_rand($a)]; }
}

class Str
{
    public static function slug(string $s, string $sep = '-'): string
    {
        $s = strtolower(preg_replace('/[^A-Za-z0-9]+/', $sep, trim($s)));
        return trim($s, $sep);
    }
    public static function studly(string $s): string { return str_replace(' ', '', ucwords(str_replace(['-', '_'], ' ', $s))); }
    public static function camel(string $s): string { return lcfirst(self::studly($s)); }
    public static function snake(string $s, string $d = '_'): string
    {
        if (!ctype_lower($s)) $s = strtolower(preg_replace('/(.)(?=[A-Z])/u', '$1' . $d, preg_replace('/\s+/u', '', ucwords($s))));
        return $s;
    }
    public static function kebab(string $s): string { return self::snake($s, '-'); }
    public static function title(string $s): string { return ucwords(strtolower($s)); }
    public static function headline(string $s): string { return ucwords(str_replace(['_', '-'], ' ', self::snake($s, ' '))); }
    public static function upper(string $s): string { return strtoupper($s); }
    public static function lower(string $s): string { return strtolower($s); }
    public static function length(string $s): int { return mb_strlen($s); }
    public static function limit(string $s, int $n = 100, string $end = '...'): string { return mb_strlen($s) <= $n ? $s : rtrim(mb_substr($s, 0, $n)) . $end; }
    public static function contains(string $h, $needles): bool { foreach ((array) $needles as $n) if ($n !== '' && str_contains($h, $n)) return true; return false; }
    public static function startsWith(string $h, $needles): bool { foreach ((array) $needles as $n) if ($n !== '' && str_starts_with($h, $n)) return true; return false; }
    public static function endsWith(string $h, $needles): bool { foreach ((array) $needles as $n) if ($n !== '' && str_ends_with($h, $n)) return true; return false; }
    public static function after(string $s, string $x): string { $p = strpos($s, $x); return $p === false ? $s : substr($s, $p + strlen($x)); }
    public static function before(string $s, string $x): string { $p = strpos($s, $x); return $p === false ? $s : substr($s, 0, $p); }
    public static function substr(string $s, int $start, ?int $len = null): string { return mb_substr($s, $start, $len); }
    public static function random(int $n = 16): string { $c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; $o = ''; for ($i = 0; $i < $n; $i++) $o .= $c[mt_rand(0, strlen($c) - 1)]; return $o; }
    public static function uuid(): string
    {
        $b = random_bytes(16); $b[6] = chr(ord($b[6]) & 0x0f | 0x40); $b[8] = chr(ord($b[8]) & 0x3f | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }
    public static function is(string $pattern, string $value): bool { return (bool) preg_match('#^' . str_replace('\*', '.*', preg_quote($pattern, '#')) . '\z#u', $value); }
    public static function replace($search, $replace, $subject): string { return str_replace($search, $replace, $subject); }
    public static function plural(string $w): string
    {
        $irregular = ['person' => 'people', 'man' => 'men', 'woman' => 'women', 'child' => 'children', 'mouse' => 'mice', 'foot' => 'feet', 'tooth' => 'teeth', 'goose' => 'geese'];
        $lower = strtolower($w);
        if (isset($irregular[$lower])) return $irregular[$lower];
        foreach (['news', 'sheep', 'fish', 'series', 'data', 'equipment', 'information'] as $u) if ($lower === $u) return $w;
        if (preg_match('/(s|x|z|ch|sh)$/i', $w)) return $w . 'es';
        if (preg_match('/[^aeiou]y$/i', $w)) return substr($w, 0, -1) . 'ies';
        if (preg_match('/(?:([^f])fe|([lr])f)$/i', $w)) return preg_replace('/(?:([^f])fe|([lr])f)$/i', '$1$2ves', $w);
        return $w . 's';
    }
    public static function singular(string $w): string
    {
        $irregular = ['people' => 'person', 'men' => 'man', 'women' => 'woman', 'children' => 'child', 'mice' => 'mouse', 'feet' => 'foot', 'teeth' => 'tooth', 'geese' => 'goose'];
        $lower = strtolower($w);
        if (isset($irregular[$lower])) return $irregular[$lower];
        if (preg_match('/ies$/i', $w)) return substr($w, 0, -3) . 'y';
        if (preg_match('/ves$/i', $w)) return substr($w, 0, -3) . 'f';
        if (preg_match('/(s|x|z|ch|sh)es$/i', $w)) return substr($w, 0, -2);
        if (preg_match('/ss$/i', $w)) return $w;
        if (preg_match('/s$/i', $w)) return substr($w, 0, -1);
        return $w;
    }
}

class MissingValue {}

class Collection implements ArrayAccess, Countable, IteratorAggregate, JsonSerializable, Arrayable
{
    protected array $items = [];
    public function __construct($items = [])
    {
        if ($items instanceof self) $this->items = $items->all();
        elseif (is_array($items)) $this->items = $items;
        elseif ($items instanceof \Traversable) $this->items = iterator_to_array($items);
        else $this->items = (array) $items;
    }
    public static function make($items = []): static { return new static($items); }
    public static function times(int $n, callable $cb): static { $o = []; for ($i = 1; $i <= $n; $i++) $o[] = $cb($i); return new static($o); }
    public function all(): array { return $this->items; }
    public function toArray(): array { return array_map(fn ($v) => $v instanceof Arrayable ? $v->toArray() : $v, $this->items); }
    public function jsonSerialize(): array
    {
        return array_map(function ($v) {
            if ($v instanceof JsonSerializable) return $v->jsonSerialize();
            if ($v instanceof Arrayable) return $v->toArray();
            return $v;
        }, $this->items);
    }
    public function toJson($options = 0): string { return json_encode($this->jsonSerialize(), $options); }
    public function count(): int { return count($this->items); }
    public function getIterator(): \ArrayIterator { return new \ArrayIterator($this->items); }
    public function offsetExists(mixed $k): bool { return isset($this->items[$k]); }
    public function offsetGet(mixed $k): mixed { return $this->items[$k]; }
    public function offsetSet(mixed $k, mixed $v): void { if ($k === null) $this->items[] = $v; else $this->items[$k] = $v; }
    public function offsetUnset(mixed $k): void { unset($this->items[$k]); }
    public function isEmpty(): bool { return empty($this->items); }
    public function isNotEmpty(): bool { return !empty($this->items); }
    public function first(?callable $cb = null, $default = null) { return Arr::first($this->items, $cb, $default); }
    public function last(?callable $cb = null, $default = null) { return Arr::last($this->items, $cb, $default); }
    public function get($k, $default = null) { return $this->items[$k] ?? ($default instanceof \Closure ? $default() : $default); }
    public function has($k): bool { return array_key_exists($k, $this->items); }
    public function push(...$v): static { foreach ($v as $x) $this->items[] = $x; return $this; }
    public function put($k, $v): static { $this->items[$k] = $v; return $this; }
    public function prepend($v, $k = null): static { if ($k === null) array_unshift($this->items, $v); else $this->items = [$k => $v] + $this->items; return $this; }
    public function pop() { return array_pop($this->items); }
    public function shift() { return array_shift($this->items); }
    public function map(callable $cb): static { $keys = array_keys($this->items); return new static(array_combine($keys, array_map($cb, $this->items, $keys))); }
    public function mapWithKeys(callable $cb): static { $o = []; foreach ($this->items as $k => $v) foreach ($cb($v, $k) as $mk => $mv) $o[$mk] = $mv; return new static($o); }
    public function flatMap(callable $cb): static { return $this->map($cb)->flatten(1); }
    public function filter(?callable $cb = null): static { return new static($cb ? array_filter($this->items, $cb, ARRAY_FILTER_USE_BOTH) : array_filter($this->items)); }
    public function reject(callable $cb): static { return $this->filter(fn ($v, $k) => !$cb($v, $k)); }
    public function values(): static { return new static(array_values($this->items)); }
    public function keys(): static { return new static(array_keys($this->items)); }
    public function pluck($value, $key = null): static { return new static(Arr::pluck($this->items, $value, $key)); }
    public function sum($cb = null) { $t = 0; foreach ($this->items as $v) $t += $cb === null ? $v : (is_callable($cb) ? $cb($v) : data_get($v, $cb)); return $t; }
    public function avg($cb = null) { $n = count($this->items); return $n ? $this->sum($cb) / $n : null; }
    public function min($cb = null) { $v = $cb === null ? $this->items : $this->pluck($cb)->all(); return $v ? min($v) : null; }
    public function max($cb = null) { $v = $cb === null ? $this->items : $this->pluck($cb)->all(); return $v ? max($v) : null; }
    public function sortBy($by, bool $desc = false): static
    {
        $items = $this->items;
        $get = fn ($v) => is_callable($by) ? $by($v) : data_get($v, $by);
        uasort($items, fn ($a, $b) => $desc ? $get($b) <=> $get($a) : $get($a) <=> $get($b));
        return new static($items);
    }
    public function sortByDesc($by): static { return $this->sortBy($by, true); }
    public function sort(?callable $cb = null): static { $i = $this->items; $cb ? uasort($i, $cb) : asort($i); return new static($i); }
    public function reverse(): static { return new static(array_reverse($this->items, true)); }
    public function unique($key = null): static
    {
        if ($key === null) return new static(array_unique($this->items, SORT_REGULAR));
        $seen = []; $o = [];
        foreach ($this->items as $k => $v) { $id = is_callable($key) ? $key($v) : data_get($v, $key); if (!in_array($id, $seen, true)) { $seen[] = $id; $o[$k] = $v; } }
        return new static($o);
    }
    public function take(int $n): static { return new static($n < 0 ? array_slice($this->items, $n, null, true) : array_slice($this->items, 0, $n, true)); }
    public function skip(int $n): static { return new static(array_slice($this->items, $n, null, true)); }
    public function slice(int $o, ?int $l = null): static { return new static(array_slice($this->items, $o, $l, true)); }
    public function chunk(int $n): static { return new static(array_map(fn ($c) => new static($c), array_chunk($this->items, $n, true))); }
    public function each(callable $cb): static { foreach ($this->items as $k => $v) if ($cb($v, $k) === false) break; return $this; }
    public function tap(callable $cb): static { $cb($this); return $this; }
    public function pipe(callable $cb) { return $cb($this); }
    public function reduce(callable $cb, $initial = null) { return array_reduce($this->items, $cb, $initial); }
    public function contains($key, $op = null, $value = null): bool
    {
        if (func_num_args() === 1) {
            if (is_callable($key) && !is_string($key)) { foreach ($this->items as $k => $v) if ($key($v, $k)) return true; return false; }
            return in_array($key, $this->items);
        }
        return $this->where($key, $op, $value)->isNotEmpty();
    }
    public function implode($value, ?string $glue = null): string { return $glue === null ? implode($value, $this->items) : implode($glue, $this->pluck($value)->all()); }
    public function groupBy($by): static
    {
        $o = [];
        foreach ($this->items as $v) { $k = is_callable($by) ? $by($v) : data_get($v, $by); $o[$k][] = $v; }
        return new static(array_map(fn ($g) => new static($g), $o));
    }
    public function keyBy($by): static { $o = []; foreach ($this->items as $v) $o[is_callable($by) ? $by($v) : data_get($v, $by)] = $v; return new static($o); }
    public function where($key, $op = null, $value = null): static
    {
        if (func_num_args() === 2) { $value = $op; $op = '='; }
        return $this->filter(function ($item) use ($key, $op, $value) {
            $v = data_get($item, $key);
            return match ($op) { '=', '==' => $v == $value, '===' => $v === $value, '!=', '<>' => $v != $value, '>' => $v > $value, '>=' => $v >= $value, '<' => $v < $value, '<=' => $v <= $value, default => $v == $value };
        });
    }
    public function whereIn($key, array $values): static { return $this->filter(fn ($i) => in_array(data_get($i, $key), $values)); }
    public function firstWhere($key, $op = null, $value = null) { return func_num_args() === 2 ? $this->where($key, $op)->first() : $this->where($key, $op, $value)->first(); }
    public function merge($items): static { return new static(array_merge($this->items, (new static($items))->all())); }
    public function concat($items): static { $o = $this->items; foreach ($items as $i) $o[] = $i; return new static($o); }
    public function flatten($depth = INF): static { return new static(Arr::flatten($this->items, $depth)); }
    public function only($keys): static { return new static(Arr::only($this->items, $keys)); }
    public function except($keys): static { return new static(Arr::except($this->items, $keys)); }
    public function search($v) { return array_search($v, $this->items); }
    public function random(?int $n = null)
    {
        if (!$this->items) return $n === null ? null : new static;
        $keys = array_keys($this->items);
        if ($n === null) return $this->items[$keys[array_rand($keys)]];
        shuffle($keys);
        return new static(array_map(fn ($k) => $this->items[$k], array_slice($keys, 0, $n)));
    }
    public function shuffle(): static { $i = $this->items; shuffle($i); return new static($i); }
    public function sortKeys(): static { $i = $this->items; ksort($i); return new static($i); }
    public function countBy($by = null): static { $o = []; foreach ($this->items as $v) { $k = $by === null ? $v : (is_callable($by) ? $by($v) : data_get($v, $by)); $o[$k] = ($o[$k] ?? 0) + 1; } return new static($o); }
    public function partition(callable $cb): static { $a = $b = []; foreach ($this->items as $k => $v) { if ($cb($v, $k)) $a[$k] = $v; else $b[$k] = $v; } return new static([new static($a), new static($b)]); }
    public function diff($items): static { return new static(array_diff($this->items, (new static($items))->all())); }
    public function intersect($items): static { return new static(array_intersect($this->items, (new static($items))->all())); }
    public function whenEmpty(callable $cb): static { if ($this->isEmpty()) $cb($this); return $this; }
    public function median($key = null) { $v = $key === null ? $this->items : $this->pluck($key)->all(); sort($v); $n = count($v); if (!$n) return null; $m = intdiv($n, 2); return $n % 2 ? $v[$m] : ($v[$m - 1] + $v[$m]) / 2; }
    public function pad(int $size, $value): static { return new static(array_pad($this->items, $size, $value)); }
    public function zip($other): static { $o = (new static($other))->all(); $i = 0; $r = []; foreach ($this->items as $v) $r[] = new static([$v, $o[$i++] ?? null]); return new static($r); }
    public function flip(): static { return new static(array_flip($this->items)); }
    public function toBase(): static { return $this; }
    public function __toString(): string { return $this->toJson(); }
}

class Carbon extends \DateTime implements JsonSerializable
{
    public function __construct($time = 'now', $tz = null) { parent::__construct($time ?? 'now', $tz ?? new \DateTimeZone('UTC')); }
    public static function now($tz = null): static { return new static('now', $tz ? new \DateTimeZone($tz) : null); }
    public static function today(): static { return (new static('today')); }
    public static function tomorrow(): static { return new static('tomorrow'); }
    public static function yesterday(): static { return new static('yesterday'); }
    public static function parse($t, $tz = null): static { return new static($t, $tz ? new \DateTimeZone($tz) : null); }
    public static function createFromTimestamp(int|float $timestamp, $tz = null): static { return (new static('@' . (int) $timestamp))->setTimezone(new \DateTimeZone('UTC')); }
    public static function createFromFormat($format, $time, $tz = null): static|false
    {
        $d = \DateTime::createFromFormat($format, $time, $tz ?? new \DateTimeZone('UTC'));
        return $d ? new static($d->format('Y-m-d H:i:s.u'), $d->getTimezone()) : false;
    }
    public function toDateString(): string { return $this->format('Y-m-d'); }
    public function toDateTimeString(): string { return $this->format('Y-m-d H:i:s'); }
    public function toTimeString(): string { return $this->format('H:i:s'); }
    public function toISOString(): string { return (clone $this)->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.u\Z'); }
    public function toIso8601String(): string { return $this->format(DATE_ATOM); }
    public function jsonSerialize(): string { return $this->toISOString(); }
    public function __toString(): string { return $this->toDateTimeString(); }
    public function __get($n) { return match ($n) { 'year' => (int) $this->format('Y'), 'month' => (int) $this->format('n'), 'day' => (int) $this->format('j'), 'hour' => (int) $this->format('G'), 'minute' => (int) $this->format('i'), 'second' => (int) $this->format('s'), 'timestamp' => $this->getTimestamp(), 'dayOfWeek' => (int) $this->format('w'), default => null }; }
    public function copy(): static { return clone $this; }
    private function shift(string $unit, int $n): static { $c = clone $this; $c->modify(($n >= 0 ? '+' : '') . $n . ' ' . $unit); return $c; }
    public function addSeconds($n = 1): static { return $this->shift('seconds', $n); }
    public function addMinutes($n = 1): static { return $this->shift('minutes', $n); }
    public function addHours($n = 1): static { return $this->shift('hours', $n); }
    public function addDays($n = 1): static { return $this->shift('days', $n); }
    public function addDay(): static { return $this->shift('days', 1); }
    public function addWeeks($n = 1): static { return $this->shift('weeks', $n); }
    public function addMonths($n = 1): static { return $this->shift('months', $n); }
    public function addYears($n = 1): static { return $this->shift('years', $n); }
    public function subSeconds($n = 1): static { return $this->shift('seconds', -$n); }
    public function subMinutes($n = 1): static { return $this->shift('minutes', -$n); }
    public function subHours($n = 1): static { return $this->shift('hours', -$n); }
    public function subDays($n = 1): static { return $this->shift('days', -$n); }
    public function subDay(): static { return $this->shift('days', -1); }
    public function subWeeks($n = 1): static { return $this->shift('weeks', -$n); }
    public function subMonths($n = 1): static { return $this->shift('months', -$n); }
    public function subYears($n = 1): static { return $this->shift('years', -$n); }
    public function startOfDay(): static { $c = clone $this; $c->setTime(0, 0, 0); return $c; }
    public function endOfDay(): static { $c = clone $this; $c->setTime(23, 59, 59); return $c; }
    public function isPast(): bool { return $this->getTimestamp() < time(); }
    public function isFuture(): bool { return $this->getTimestamp() > time(); }
    public function diffInSeconds($o = null): int { return abs(($o ? Carbon::parse($o)->getTimestamp() : time()) - $this->getTimestamp()); }
    public function diffInMinutes($o = null): int { return intdiv($this->diffInSeconds($o), 60); }
    public function diffInHours($o = null): int { return intdiv($this->diffInSeconds($o), 3600); }
    public function diffInDays($o = null): int { return intdiv($this->diffInSeconds($o), 86400); }
    public function diffForHumans(): string
    {
        $s = time() - $this->getTimestamp(); $future = $s < 0; $s = abs($s);
        foreach ([[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']] as [$sec, $name]) {
            if ($s >= $sec) { $n = intdiv($s, $sec); return $n . ' ' . $name . ($n > 1 ? 's' : '') . ($future ? ' from now' : ' ago'); }
        }
        return $future ? 'in a few seconds' : 'a few seconds ago';
    }
}

}

namespace {

use Illuminate\Support\Arr;
use Illuminate\Support\Collection;

if (!function_exists('collect')) {
    function collect($items = []) { return new Collection($items); }
    function value($v, ...$args) { return $v instanceof Closure ? $v(...$args) : $v; }
    function tap($v, $cb = null) { if ($cb) $cb($v); return $v; }
    function with($v, $cb = null) { return $cb ? $cb($v) : $v; }
    function blank($v): bool { return $v === null || (is_string($v) && trim($v) === '') || (is_countable($v) && count($v) === 0); }
    function filled($v): bool { return !blank($v); }
    function head($a) { return reset($a); }
    function last($a) { return end($a); }
    function now($tz = null) { return Illuminate\Support\Carbon::now($tz); }
    function today() { return Illuminate\Support\Carbon::today(); }
    function class_basename($c) { $c = is_object($c) ? get_class($c) : $c; return basename(str_replace('\\', '/', $c)); }
    function e($v) { return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'); }
    function bcrypt($v, $opts = []) { return password_hash($v, PASSWORD_BCRYPT, ['cost' => $opts['rounds'] ?? 4]); }
    function data_get($target, $key, $default = null)
    {
        if ($key === null) return $target;
        foreach (is_array($key) ? $key : explode('.', (string) $key) as $seg) {
            if ($target instanceof Collection) $target = $target->all();
            if (is_array($target) && array_key_exists($seg, $target)) $target = $target[$seg];
            elseif (is_object($target) && (isset($target->$seg) || property_exists($target, $seg))) $target = $target->$seg;
            elseif ($target instanceof ArrayAccess && isset($target[$seg])) $target = $target[$seg];
            else return value($default);
        }
        return $target;
    }
    function data_set(&$target, $key, $value) { Arr::set($target, $key, $value); return $target; }
}

}
