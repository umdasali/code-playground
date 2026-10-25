<?php
// Laravel-style mini framework: Eloquent (models, builder, relations, collections, soft deletes) and API resources.

namespace Illuminate\Database\Eloquent {

use Illuminate\Contracts\Support\Arrayable;
use Illuminate\Contracts\Support\Jsonable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

class ModelNotFoundException extends \RuntimeException
{
    public array $ids = []; public string $model = '';
    public function setModel(string $model, $ids = []): static
    {
        $this->model = $model; $this->ids = (array) $ids;
        $this->message = "No query results for model [$model]" . ($this->ids ? ' ' . implode(', ', $this->ids) : '.');
        return $this;
    }
}
class MassAssignmentException extends \RuntimeException {}

class Collection extends \Illuminate\Support\Collection
{
    public function modelKeys(): array { return array_map(fn ($m) => $m->getKey(), $this->items); }
    public function find($key, $default = null) { foreach ($this->items as $m) if ($m->getKey() == $key) return $m; return $default; }
    public function load($relations): static
    {
        if ($this->items) (new Builder((new \Illuminate\Database\Query\Builder(reset($this->items)->getConnection()))))->setModel(reset($this->items))->with($relations)->eagerLoadRelations($this->items);
        return $this;
    }
    public function fresh(): static { return new static(array_map(fn ($m) => $m->fresh(), $this->items)); }
    public function toArray(): array { return array_map(fn ($m) => $m instanceof Arrayable ? $m->toArray() : $m, $this->items); }
}

#[\Attribute]
class Attribute
{
    public function __construct(public ?\Closure $get = null, public ?\Closure $set = null) {}
    public static function make(?callable $get = null, ?callable $set = null): static { return new static($get ? \Closure::fromCallable($get) : null, $set ? \Closure::fromCallable($set) : null); }
    public static function get(callable $get): static { return static::make($get); }
    public static function set(callable $set): static { return static::make(null, $set); }
}

trait SoftDeletes
{
    public function trashed(): bool { return $this->getAttribute('deleted_at') !== null; }
    public function restore(): bool { $this->setAttribute('deleted_at', null); return $this->save(); }
    public function forceDelete(): bool { return $this->performDelete(true); }
    public static function withTrashed() { return static::query()->withTrashed(); }
    public static function onlyTrashed() { return static::query()->onlyTrashed(); }
}

abstract class Model implements \ArrayAccess, \JsonSerializable, Arrayable, Jsonable
{
    protected $table;
    protected $primaryKey = 'id';
    protected $keyType = 'int';
    public $incrementing = true;
    public $timestamps = true;
    protected $fillable = [];
    protected $guarded = ['*'];
    protected $hidden = [];
    protected $visible = [];
    protected $casts = [];
    protected $appends = [];
    protected $with = [];
    protected $attributes = [];
    protected array $original = [];
    protected array $relations = [];
    public bool $exists = false;
    public bool $wasRecentlyCreated = false;
    protected static ?\Illuminate\Database\Connection $resolver = null;
    protected static bool $unguarded = false;

    const CREATED_AT = 'created_at';
    const UPDATED_AT = 'updated_at';

    public function __construct(array $attributes = [])
    {
        $this->original = $this->attributes;
        if ($attributes) $this->fill($attributes);
    }

    public static function setConnectionResolver(\Illuminate\Database\Connection $c): void { static::$resolver = $c; }
    public function getConnection(): \Illuminate\Database\Connection { return static::$resolver ?? \Illuminate\Support\Facades\DB::connection(); }

    // ----- querying -----
    public static function query(): Builder { return (new static)->newQuery(); }
    public function newQuery(): Builder
    {
        $q = new Builder((new \Illuminate\Database\Query\Builder($this->getConnection()))->from($this->getTable()));
        return $q->setModel($this)->with($this->with);
    }
    public static function __callStatic($m, $a) { return (new static)->$m(...$a); }
    public function __call($m, $a)
    {
        if (in_array($m, ['increment', 'decrement'], true)) return $this->incrementOrDecrement($m, ...$a);
        return $this->newQuery()->$m(...$a);
    }
    protected function incrementOrDecrement(string $m, $column, $amount = 1, array $extra = [])
    {
        $q = $this->newQuery()->where($this->getKeyName(), $this->getKey());
        $this->setAttribute($column, $this->getAttribute($column) + ($m === 'increment' ? $amount : -$amount));
        return $q->{$m}($column, $amount, $extra);
    }
    public function newInstance(array $attributes = [], bool $exists = false): static
    {
        $m = new static;
        $m->exists = $exists;
        if ($attributes) $m->fill($attributes);
        return $m;
    }
    public function newFromBuilder(array $attrs): static
    {
        $m = new static;
        $m->exists = true;
        $m->attributes = $attrs;
        $m->original = $attrs;
        return $m;
    }
    public function newCollection(array $models = []): Collection { return new Collection($models); }

    public function getTable(): string { return $this->table ?? Str::snake(Str::plural(class_basename($this))); }
    public function setTable(string $t): static { $this->table = $t; return $this; }
    public function getKeyName(): string { return $this->primaryKey; }
    public function getKey() { return $this->getAttribute($this->primaryKey); }
    public function getRouteKey() { return $this->getAttribute($this->getRouteKeyName()); }
    public function getRouteKeyName(): string { return $this->primaryKey; }
    public function resolveRouteBinding($value, $field = null)
    {
        $m = $this->newQuery()->where($field ?? $this->getRouteKeyName(), $value)->first();
        if (!$m) throw (new ModelNotFoundException)->setModel(static::class, [$value]);
        return $m;
    }

    // ----- attributes -----
    public function getFillable(): array { return $this->fillable; }
    public static function unguard(bool $state = true): void { static::$unguarded = $state; }
    public static function reguard(): void { static::$unguarded = false; }
    public static function preventLazyLoading(bool $v = true): void {}
    public static function shouldBeStrict(bool $v = true): void {}
    public static function preventSilentlyDiscardingAttributes(bool $v = true): void {}
    public function isFillable(string $key): bool
    {
        if (static::$unguarded) return true;
        if (in_array($key, $this->fillable, true)) return true;
        if ($this->fillable !== []) return false;
        if ($this->guarded === ['*']) return false;
        return !in_array($key, $this->guarded, true);
    }
    public function fill(array $attributes): static
    {
        $totallyGuarded = !static::$unguarded && $this->fillable === [] && $this->guarded === ['*'];
        foreach ($attributes as $k => $v) {
            if ($this->isFillable($k)) $this->setAttribute($k, $v);
            elseif ($totallyGuarded) throw new MassAssignmentException("Add [$k] to fillable property to allow mass assignment on [" . static::class . '].');
        }
        return $this;
    }
    public function forceFill(array $a): static { foreach ($a as $k => $v) $this->setAttribute($k, $v); return $this; }

    protected function accessorName(string $key, string $prefix): string { return $prefix . Str::studly($key) . 'Attribute'; }
    protected function attributeObject(string $key): ?Attribute
    {
        $m = Str::camel($key);
        if (method_exists($this, $m) && !method_exists(self::class, $m)) {
            $rt = (new \ReflectionMethod($this, $m))->getReturnType();
            if ($rt instanceof \ReflectionNamedType && $rt->getName() === Attribute::class) return $this->$m();
        }
        return null;
    }

    public function getAttribute($key)
    {
        if ($key === null || $key === '') return null;
        if (array_key_exists($key, $this->attributes) || $this->hasGetMutator($key) || $this->attributeObject($key)) return $this->getAttributeValue($key);
        if (array_key_exists($key, $this->relations)) return $this->relations[$key];
        if (method_exists($this, $key) && !method_exists(self::class, $key)) {
            $rel = $this->$key();
            if ($rel instanceof Relations\Relation) { $r = $rel->getResults(); $this->relations[$key] = $r; return $r; }
        }
        return null;
    }
    protected function hasGetMutator(string $k): bool { return method_exists($this, $this->accessorName($k, 'get')); }
    protected function getAttributeValue(string $key)
    {
        $value = $this->attributes[$key] ?? null;
        if ($attr = $this->attributeObject($key)) { if ($attr->get) return ($attr->get)($value, $this->attributes); }
        if ($this->hasGetMutator($key)) return $this->{$this->accessorName($key, 'get')}($value);
        return $this->castAttribute($key, $value);
    }
    protected function castType(string $key): ?string
    {
        $t = $this->getCasts()[$key] ?? null;
        return $t ? strtolower(explode(':', $t)[0]) : null;
    }
    public function getCasts(): array
    {
        $c = $this->casts;
        if (method_exists($this, 'casts')) $c = array_merge($c, $this->casts());
        if ($this->timestamps) { $c[static::CREATED_AT] ??= 'datetime'; $c[static::UPDATED_AT] ??= 'datetime'; }
        return $c;
    }
    protected function castAttribute(string $key, $value)
    {
        $type = $this->castType($key);
        if ($value === null || $type === null) return $value;
        switch ($type) {
            case 'int': case 'integer': return (int) $value;
            case 'real': case 'float': case 'double': return (float) $value;
            case 'string': return (string) $value;
            case 'bool': case 'boolean': return (bool) $value;
            case 'decimal': return number_format((float) $value, (int) (explode(':', $this->getCasts()[$key])[1] ?? 2), '.', '');
            case 'array': case 'json': return is_string($value) ? json_decode($value, true) : $value;
            case 'object': return is_string($value) ? json_decode($value) : $value;
            case 'collection': return new \Illuminate\Support\Collection(is_string($value) ? json_decode($value, true) : $value);
            case 'date': case 'datetime': case 'immutable_date': case 'immutable_datetime': case 'timestamp':
                if ($value instanceof \DateTimeInterface) return $value instanceof Carbon ? $value : Carbon::parse($value->format('Y-m-d H:i:s.u'));
                return is_numeric($value) && $type === 'timestamp' ? Carbon::createFromTimestamp((int) $value) : Carbon::parse($value);
        }
        return $value;
    }
    public function setAttribute($key, $value): static
    {
        if ($attr = $this->attributeObject($key)) { if ($attr->set) { $r = ($attr->set)($value, $this->attributes); if (is_array($r)) { foreach ($r as $k => $v) $this->attributes[$k] = $v; return $this; } $value = $r; } }
        elseif (method_exists($this, $this->accessorName($key, 'set'))) { $this->{$this->accessorName($key, 'set')}($value); return $this; }
        $type = $this->castType($key);
        if ($value !== null && $type) {
            if (in_array($type, ['array', 'json', 'object', 'collection'], true)) $value = json_encode($value);
            elseif (in_array($type, ['date', 'datetime', 'immutable_date', 'immutable_datetime'], true)) $value = ($value instanceof \DateTimeInterface ? $value : Carbon::parse($value))->format($type === 'date' ? 'Y-m-d' : 'Y-m-d H:i:s');
            elseif ($type === 'hashed') $value = password_get_info((string) $value)['algo'] ? $value : bcrypt((string) $value);
            elseif (in_array($type, ['bool', 'boolean'], true)) $value = $value ? 1 : 0;
        }
        if ($value instanceof \DateTimeInterface) $value = $value->format('Y-m-d H:i:s');
        $this->attributes[$key] = $value;
        return $this;
    }
    public function getAttributes(): array { return $this->attributes; }
    public function only($attrs): array { $out = []; foreach (is_array($attrs) ? $attrs : func_get_args() as $a) $out[$a] = $this->getAttribute($a); return $out; }
    public function except($attrs): array { return array_diff_key($this->toArray(), array_flip(is_array($attrs) ? $attrs : func_get_args())); }
    public function getOriginal($key = null, $default = null) { return $key === null ? $this->original : ($this->original[$key] ?? $default); }
    public function getDirty(): array { return array_filter($this->attributes, fn ($v, $k) => !array_key_exists($k, $this->original) || $this->original[$k] !== $v && (string) $this->original[$k] !== (string) $v, ARRAY_FILTER_USE_BOTH); }
    public function isDirty($attrs = null): bool { $d = $this->getDirty(); if ($attrs === null) return $d !== []; foreach ((array) $attrs as $a) if (array_key_exists($a, $d)) return true; return false; }
    public function isClean($attrs = null): bool { return !$this->isDirty($attrs); }
    public function wasChanged($attrs = null): bool { return true; }
    public function syncOriginal(): static { $this->original = $this->attributes; return $this; }
    public function __get($k) { return $this->getAttribute($k); }
    public function __set($k, $v) { $this->setAttribute($k, $v); }
    public function __isset($k): bool { return $this->getAttribute($k) !== null; }
    public function __unset($k) { unset($this->attributes[$k], $this->relations[$k]); }
    public function offsetExists(mixed $k): bool { return isset($this->$k); }
    public function offsetGet(mixed $k): mixed { return $this->getAttribute($k); }
    public function offsetSet(mixed $k, mixed $v): void { $this->setAttribute($k, $v); }
    public function offsetUnset(mixed $k): void { unset($this->$k); }

    // ----- persistence -----
    protected function freshTimestamp(): string { return Carbon::now()->format('Y-m-d H:i:s'); }
    public function touch(): bool { if (!$this->timestamps) return false; $this->setAttribute(static::UPDATED_AT, $this->freshTimestamp()); return $this->save(); }
    public function save(array $options = []): bool
    {
        $q = $this->newQuery();
        if ($this->exists) {
            if (!$this->isDirty()) return true;
            if ($this->timestamps && !$this->isDirty(static::UPDATED_AT)) $this->attributes[static::UPDATED_AT] = $this->freshTimestamp();
            $dirty = $this->getDirty();
            $q->toBase()->where($this->getKeyName(), $this->getKey())->update($dirty);
        } else {
            if ($this->timestamps) {
                $now = $this->freshTimestamp();
                $this->attributes[static::UPDATED_AT] ??= $now;
                $this->attributes[static::CREATED_AT] ??= $now;
            }
            if ($this->incrementing) {
                $attrs = $this->attributes;
                if (array_key_exists($this->getKeyName(), $attrs) && $attrs[$this->getKeyName()] === null) unset($attrs[$this->getKeyName()]);
                $id = $q->toBase()->insertGetId($attrs);
                if (!isset($this->attributes[$this->getKeyName()])) $this->attributes[$this->getKeyName()] = $id;
            } else {
                $q->toBase()->insert($this->attributes);
            }
            $this->exists = true;
            $this->wasRecentlyCreated = true;
        }
        $this->syncOriginal();
        return true;
    }
    public function update(array $attributes = [], array $options = []): bool { if (!$this->exists) return false; return $this->fill($attributes)->save(); }
    public function delete(): bool|null { return $this->performDelete(false); }
    protected function performDelete(bool $force): bool
    {
        if (!$this->exists) return false;
        if (!$force && in_array(SoftDeletes::class, class_uses($this) ?: [], true)) {
            $this->setAttribute('deleted_at', $this->freshTimestamp());
            return $this->save();
        }
        $this->newQuery()->toBase()->where($this->getKeyName(), $this->getKey())->delete();
        $this->exists = false;
        return true;
    }
    public static function destroy($ids): int
    {
        $n = 0;
        foreach (is_array($ids) ? $ids : func_get_args() as $id) { $m = static::find($id); if ($m && $m->delete()) $n++; }
        return $n;
    }
    public function fresh($with = []): ?static { return $this->exists ? static::query()->with($with)->find($this->getKey()) : null; }
    public function refresh(): static
    {
        $f = static::query()->find($this->getKey());
        if ($f) { $this->attributes = $f->attributes; $this->original = $f->original; $this->relations = []; }
        return $this;
    }
    public function replicate(?array $except = null): static
    {
        $a = $this->attributes; unset($a[$this->getKeyName()], $a[static::CREATED_AT], $a[static::UPDATED_AT]);
        return (new static)->forceFill($a);
    }
    public function is($m): bool { return $m instanceof self && $m->getKey() === $this->getKey() && $m->getTable() === $this->getTable(); }

    // ----- relations -----
    public function setRelation(string $name, $value): static { $this->relations[$name] = $value; return $this; }
    public function relationLoaded(string $name): bool { return array_key_exists($name, $this->relations); }
    public function getRelations(): array { return $this->relations; }
    public function getRelation(string $name) { return $this->relations[$name] ?? null; }
    public function load($relations): static
    {
        (new Builder(new \Illuminate\Database\Query\Builder($this->getConnection())))->setModel($this)->with(is_array($relations) ? $relations : func_get_args())->eagerLoadRelations([$this]);
        return $this;
    }
    public function loadMissing($relations): static { foreach ((array) $relations as $r) if (!$this->relationLoaded(explode('.', $r)[0])) $this->load($r); return $this; }
    public function loadCount($r): static { return $this; }

    public function hasMany(string $related, ?string $foreignKey = null, ?string $localKey = null): Relations\HasMany
    {
        $i = new $related;
        return new Relations\HasMany($i->newQuery(), $this, $i->getTable() . '.' . ($foreignKey ?? Str::snake(class_basename($this)) . '_' . $this->getKeyName()), $localKey ?? $this->getKeyName());
    }
    public function hasOne(string $related, ?string $foreignKey = null, ?string $localKey = null): Relations\HasOne
    {
        $i = new $related;
        return new Relations\HasOne($i->newQuery(), $this, $i->getTable() . '.' . ($foreignKey ?? Str::snake(class_basename($this)) . '_' . $this->getKeyName()), $localKey ?? $this->getKeyName());
    }
    public function belongsTo(string $related, ?string $foreignKey = null, ?string $ownerKey = null, ?string $relation = null): Relations\BelongsTo
    {
        $relation ??= debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 2)[1]['function'];
        $i = new $related;
        return new Relations\BelongsTo($i->newQuery(), $this, $foreignKey ?? Str::snake($relation) . '_' . $i->getKeyName(), $ownerKey ?? $i->getKeyName(), $relation);
    }
    public function belongsToMany(string $related, ?string $table = null, ?string $foreignPivotKey = null, ?string $relatedPivotKey = null): Relations\BelongsToMany
    {
        $i = new $related;
        $names = [Str::snake(class_basename($this)), Str::snake(class_basename($related))];
        sort($names);
        return new Relations\BelongsToMany($i->newQuery(), $this, $table ?? implode('_', $names), $foreignPivotKey ?? Str::snake(class_basename($this)) . '_' . $this->getKeyName(), $relatedPivotKey ?? Str::snake(class_basename($related)) . '_' . $i->getKeyName());
    }

    // ----- serialization -----
    public function makeHidden($attrs): static { $this->hidden = array_merge($this->hidden, (array) $attrs); return $this; }
    public function makeVisible($attrs): static { $this->hidden = array_diff($this->hidden, (array) $attrs); return $this; }
    public function append($attrs): static { $this->appends = array_merge($this->appends, (array) $attrs); return $this; }
    public function attributesToArray(): array
    {
        $out = [];
        foreach ($this->attributes as $k => $v) {
            if ($this->hidden && in_array($k, $this->hidden, true)) continue;
            if ($this->visible && !in_array($k, $this->visible, true)) continue;
            $val = $this->getAttributeValue($k);
            $out[$k] = $val instanceof Carbon ? $this->serializeDate($k, $val) : ($val instanceof Arrayable ? $val->toArray() : $val);
        }
        foreach ($this->appends as $k) $out[$k] = $this->getAttributeValue($k);
        return $out;
    }
    protected function serializeDate(string $key, Carbon $d)
    {
        $cast = $this->getCasts()[$key] ?? '';
        if (str_contains($cast, ':') && in_array(explode(':', $cast)[0], ['date', 'datetime'], true)) return $d->format(substr($cast, strpos($cast, ':') + 1));
        return $d->toISOString();
    }
    public function relationsToArray(): array
    {
        $out = [];
        foreach ($this->relations as $k => $v) {
            if ($this->hidden && in_array($k, $this->hidden, true)) continue;
            $out[Str::snake($k)] = $v instanceof Arrayable ? $v->toArray() : $v;
        }
        return $out;
    }
    public function toArray(): array { return array_merge($this->attributesToArray(), $this->relationsToArray()); }
    public function toJson($options = 0): string { return json_encode($this->jsonSerialize(), $options); }
    public function jsonSerialize(): array { return $this->toArray(); }
    public function __toString(): string { return $this->toJson(); }
}

class Builder
{
    protected Model $model;
    protected array $eagerLoad = [];
    protected array $withCounts = [];
    protected bool $withTrashedFlag = false;
    protected bool $onlyTrashedFlag = false;
    protected array $passthru = ['insert', 'insertGetId', 'toSql', 'getBindings', 'exists', 'doesntExist', 'count', 'min', 'max', 'avg', 'average', 'sum', 'truncate', 'pluck', 'value', 'getRows', 'whereExists', 'dump'];

    public function __construct(protected \Illuminate\Database\Query\Builder $query) {}
    public function setModel(Model $m): static { $this->model = $m; return $this; }
    public function getModel(): Model { return $this->model; }
    public function toBase(): \Illuminate\Database\Query\Builder { return $this->applyScopes()->query; }
    public function getQuery(): \Illuminate\Database\Query\Builder { return $this->query; }

    protected function usesSoftDeletes(): bool { return in_array(SoftDeletes::class, class_uses($this->model) ?: [], true); }
    protected function applyScopes(): static
    {
        if ($this->usesSoftDeletes() && !$this->withTrashedFlag) {
            $col = $this->model->getTable() . '.deleted_at';
            $has = false;
            foreach ($this->query->wheres as $w) if (($w['type'] ?? '') === 'null' && ($w['column'] ?? '') === $col) $has = true;
            if ($this->onlyTrashedFlag) { if (!$has) $this->query->whereNotNull($col); }
            elseif (!$has) $this->query->whereNull($col);
        }
        return $this;
    }
    public function withTrashed(): static { $this->withTrashedFlag = true; return $this; }
    public function onlyTrashed(): static { $this->onlyTrashedFlag = true; return $this; }
    public function withoutTrashed(): static { $this->withTrashedFlag = false; $this->onlyTrashedFlag = false; return $this; }

    public function with($relations, $callback = null): static
    {
        if (is_string($relations)) $relations = $callback ? [$relations => $callback] : [$relations];
        foreach ($relations as $k => $v) { if (is_int($k)) $this->eagerLoad[$v] = null; else $this->eagerLoad[$k] = $v; }
        return $this;
    }
    public function withCount($relations): static { foreach ((array) $relations as $r) $this->withCounts[] = $r; return $this; }

    public function hydrate(array $rows): Collection
    {
        return $this->model->newCollection(array_map(fn ($r) => $this->model->newFromBuilder($r), $rows));
    }
    public function get($columns = ['*']): Collection
    {
        $this->applyScopes();
        if ($columns !== ['*']) $this->query->columns = (array) $columns;
        elseif (!$this->query->columns) $this->query->columns = [$this->model->getTable() . '.*'];
        $models = $this->hydrate($this->query->getRows())->all();
        if ($models) { $this->eagerLoadRelations($models); $this->loadCounts($models); }
        return $this->model->newCollection($models);
    }
    public function all($columns = ['*']): Collection { return $this->get($columns); }
    public function first($columns = ['*']) { return $this->limit(1)->get($columns)->first(); }
    public function firstOrFail($columns = ['*']) { $m = $this->first($columns); if (!$m) throw (new ModelNotFoundException)->setModel(get_class($this->model)); return $m; }
    public function firstOr(callable $cb) { return $this->first() ?? $cb(); }
    public function sole($columns = ['*']) { return $this->firstOrFail($columns); }
    public function find($id, $columns = ['*'])
    {
        if (is_array($id) || $id instanceof \Illuminate\Support\Collection) return $this->whereKey($id)->get($columns);
        return $this->whereKey($id)->first($columns);
    }
    public function findOrFail($id, $columns = ['*'])
    {
        $r = $this->find($id, $columns);
        if (is_array($id) ? count($r) !== count(array_unique($id)) : $r === null) throw (new ModelNotFoundException)->setModel(get_class($this->model), $id);
        return $r;
    }
    public function findMany($ids): Collection { return $this->find((array) $ids); }
    public function whereKey($id): static { is_array($id) || $id instanceof \Illuminate\Support\Collection ? $this->query->whereIn($this->model->getTable() . '.' . $this->model->getKeyName(), $id) : $this->query->where($this->model->getTable() . '.' . $this->model->getKeyName(), '=', $id); return $this; }
    public function create(array $attributes = []): Model { $m = $this->model->newInstance($attributes); $m->save(); return $m; }
    public function forceCreate(array $attributes): Model { $m = $this->model->newInstance(); $m->forceFill($attributes)->save(); return $m; }
    public function firstOrCreate(array $attributes, array $values = []): Model { return (clone $this)->where($attributes)->first() ?? $this->create($attributes + $values); }
    public function firstOrNew(array $attributes, array $values = []): Model { return (clone $this)->where($attributes)->first() ?? $this->model->newInstance($attributes + $values); }
    public function updateOrCreate(array $attributes, array $values = []): Model { $m = $this->firstOrNew($attributes); $m->fill($values)->save(); return $m; }
    public function firstWhere(...$args) { return $this->where(...$args)->first(); }
    public function update(array $values): int
    {
        if ($this->model->timestamps && !array_key_exists($this->model::UPDATED_AT, $values)) $values[$this->model::UPDATED_AT] = Carbon::now()->format('Y-m-d H:i:s');
        return $this->toBase()->update($values);
    }
    public function delete(): int
    {
        if ($this->usesSoftDeletes()) return $this->update(['deleted_at' => Carbon::now()->format('Y-m-d H:i:s')]);
        return $this->toBase()->delete();
    }
    public function forceDelete(): int { return $this->withTrashed()->toBase()->delete(); }
    public function latest($column = null): static { $this->query->latest($column ?? $this->model::CREATED_AT); return $this; }
    public function oldest($column = null): static { $this->query->oldest($column ?? $this->model::CREATED_AT); return $this; }
    public function paginate(int $perPage = 15, $columns = ['*'], string $pageName = 'page', ?int $page = null)
    {
        $this->applyScopes();
        $page = $page ?? max(1, (int) \request()->query($pageName, 1));
        $total = (clone $this)->toBase()->count();
        $items = $total ? (clone $this)->forPage($page, $perPage)->get($columns) : $this->model->newCollection();
        return new \Illuminate\Pagination\LengthAwarePaginator($items, $total, $perPage, $page, ['path' => \request()->url()]);
    }
    public function simplePaginate(int $perPage = 15, $columns = ['*'], string $pageName = 'page', ?int $page = null) { return $this->paginate($perPage, $columns, $pageName, $page); }
    public function chunk(int $count, callable $cb): bool
    {
        $page = 1;
        do { $r = (clone $this)->forPage($page, $count)->get(); if ($r->isEmpty()) break; if ($cb($r, $page) === false) return false; $page++; } while ($r->count() === $count);
        return true;
    }
    public function each(callable $cb, int $count = 1000): bool { return $this->chunk($count, function ($items) use ($cb) { foreach ($items as $i) if ($cb($i) === false) return false; }); }
    public function when($cond, callable $cb, ?callable $else = null): static { if ($cond) $cb($this, $cond); elseif ($else) $else($this, $cond); return $this; }
    public function unless($cond, callable $cb, ?callable $else = null): static { return $this->when(!$cond, $cb, $else); }
    public function tap(callable $cb): static { $cb($this); return $this; }
    public function scopes(array $s): static { foreach ($s as $k => $v) is_int($k) ? $this->$v() : $this->$k(...(array) $v); return $this; }

    // ----- relationship existence -----
    public function has(string $relation, string $operator = '>=', int $count = 1, string $boolean = 'and', ?callable $cb = null): static
    {
        $rel = $this->model->$relation();
        $sub = $rel->getRelationExistenceQuery();
        if ($cb) $cb($sub);
        $base = $sub->toBase();
        if ($operator === '>=' && $count === 1) { $this->query->wheres[] = ['type' => 'exists', 'query' => $base, 'boolean' => $boolean, 'not' => false]; return $this; }
        $base->columns = [new \Illuminate\Database\Expression('count(*)')];
        [$sql, $b] = $base->compileSelect();
        $this->query->whereRaw("($sql) $operator ?", array_merge($b, [$count]), $boolean);
        return $this;
    }
    public function whereHas(string $relation, ?callable $cb = null, string $operator = '>=', int $count = 1): static { return $this->has($relation, $operator, $count, 'and', $cb); }
    public function orWhereHas(string $relation, ?callable $cb = null): static { return $this->has($relation, '>=', 1, 'or', $cb); }
    public function doesntHave(string $relation, string $boolean = 'and', ?callable $cb = null): static
    {
        $sub = $this->model->$relation()->getRelationExistenceQuery();
        if ($cb) $cb($sub);
        $this->query->wheres[] = ['type' => 'exists', 'query' => $sub->toBase(), 'boolean' => $boolean, 'not' => true];
        return $this;
    }
    public function whereDoesntHave(string $relation, ?callable $cb = null): static { return $this->doesntHave($relation, 'and', $cb); }

    // ----- eager loading -----
    public function eagerLoadRelations(array $models): array
    {
        $groups = [];
        foreach ($this->eagerLoad as $name => $constraint) {
            $parts = explode('.', $name, 2);
            if (str_contains($parts[0], ':') && !isset($parts[1])) { // with('customer:id,name') selects only those columns
                [$rel, $cols] = explode(':', $parts[0], 2);
                $groups[$rel]['columns'] = explode(',', $cols);
                $parts[0] = $rel;
            }
            $groups[$parts[0]]['constraint'] ??= null;
            if (!isset($parts[1])) $groups[$parts[0]]['constraint'] = $constraint;
            else $groups[$parts[0]]['nested'][] = $parts[1];
        }
        foreach ($groups as $name => $g) {
            $models = $this->loadRelation($models, $name, $g['constraint'] ?? null, $g['nested'] ?? [], $g['columns'] ?? null);
        }
        return $models;
    }
    protected function loadRelation(array $models, string $name, ?callable $constraint, array $nested, ?array $columns = null): array
    {
        $relation = Relations\Relation::noConstraints(fn () => $this->model->newInstance()->$name());
        $relation->addEagerConstraints($models);
        if ($columns) $relation->getQuery()->getQuery()->columns = array_map(fn ($c) => $relation->getRelated()->getTable() . '.' . trim($c), $columns);
        if ($nested) $relation->getQuery()->with($nested);
        if ($constraint) $constraint($relation->getQuery());
        $results = $relation->getEager();
        $models = $relation->match($relation->initRelation($models, $name), $results, $name);
        return $models;
    }
    protected function loadCounts(array $models): void
    {
        foreach ($this->withCounts as $spec) {
            $name = $spec; $alias = Str::snake($spec) . '_count';
            if (preg_match('/^(\w+)\s+as\s+(\w+)$/i', $spec, $m)) { $name = $m[1]; $alias = $m[2]; }
            $relation = Relations\Relation::noConstraints(fn () => $this->model->newInstance()->$name());
            $counts = $relation->getCountsForModels($models);
            foreach ($models as $mod) $mod->setAttribute($alias, $counts[$mod->getAttribute($relation->getParentKeyName())] ?? 0);
        }
    }

    public function __call($method, $args)
    {
        $scope = 'scope' . Str::studly($method);
        if (method_exists($this->model, $scope)) { $this->model->$scope($this, ...$args); return $this; }
        if (in_array($method, $this->passthru, true)) { $this->applyScopes(); return $this->query->$method(...$args); }
        $r = $this->query->$method(...$args);
        return $r === $this->query ? $this : $r;
    }
    public function __clone() { $this->query = clone $this->query; }
}

}

namespace Illuminate\Database\Eloquent\Relations {

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;

abstract class Relation
{
    protected static bool $constraints = true;
    public static function noConstraints(callable $cb)
    {
        $prev = static::$constraints; static::$constraints = false;
        try { return $cb(); } finally { static::$constraints = $prev; }
    }
    public function __construct(protected Builder $query, protected Model $parent)
    {
        if (static::$constraints) $this->addConstraints();
    }
    abstract public function addConstraints(): void;
    abstract public function addEagerConstraints(array $models): void;
    abstract public function initRelation(array $models, string $relation): array;
    abstract public function match(array $models, Collection $results, string $relation): array;
    abstract public function getResults();
    abstract public function getRelationExistenceQuery(): Builder;
    public function getCountsForModels(array $models): array { return []; }
    public function getParentKeyName(): string { return $this->parent->getKeyName(); }
    public function getQuery(): Builder { return $this->query; }
    public function getEager(): Collection { return $this->query->get(); }
    public function getRelated(): Model { return $this->query->getModel(); }
    public function get($columns = ['*']) { return $this->query->get($columns); }
    protected function keys(array $models, string $key): array
    {
        return array_values(array_unique(array_filter(array_map(fn ($m) => $m->getAttribute($key), $models), fn ($v) => $v !== null)));
    }
    public function __call($method, $args)
    {
        $r = $this->query->$method(...$args);
        return $r === $this->query ? $this : $r;
    }
}

class HasMany extends Relation
{
    public function __construct(Builder $query, Model $parent, protected string $foreignKey, protected string $localKey) { parent::__construct($query, $parent); }
    protected function plainFk(): string { return preg_replace('/^.*\./', '', $this->foreignKey); }
    public function addConstraints(): void { $this->query->where($this->foreignKey, '=', $this->parent->getAttribute($this->localKey)); }
    public function addEagerConstraints(array $models): void { $this->query->whereIn($this->foreignKey, $this->keys($models, $this->localKey)); }
    public function initRelation(array $models, string $relation): array { foreach ($models as $m) $m->setRelation($relation, new Collection); return $models; }
    public function match(array $models, Collection $results, string $relation): array
    {
        $dict = [];
        foreach ($results as $r) $dict[$r->getAttribute($this->plainFk())][] = $r;
        foreach ($models as $m) $m->setRelation($relation, new Collection($dict[$m->getAttribute($this->localKey)] ?? []));
        return $models;
    }
    public function getResults() { return $this->parent->getAttribute($this->localKey) === null ? new Collection : $this->query->get(); }
    public function getParentKeyName(): string { return $this->localKey; }
    public function getRelationExistenceQuery(): Builder
    {
        $q = $this->getRelated()->newQuery();
        return $q->whereColumn($this->foreignKey, '=', $this->parent->getTable() . '.' . $this->localKey);
    }
    public function getCountsForModels(array $models): array
    {
        $ids = $this->keys($models, $this->localKey);
        if (!$ids) return [];
        $rows = $this->getRelated()->newQuery()->toBase()->select([$this->foreignKey . ' as fk', new \Illuminate\Database\Expression('count(*) as c')])->whereIn($this->foreignKey, $ids)->groupBy($this->foreignKey)->getRows();
        $out = [];
        foreach ($rows as $r) $out[$r['fk']] = (int) $r['c'];
        return $out;
    }
    public function make(array $attrs = []): Model { $m = $this->getRelated()->newInstance($attrs); $m->setAttribute($this->plainFk(), $this->parent->getAttribute($this->localKey)); return $m; }
    public function create(array $attrs = []): Model { $m = $this->make($attrs); $m->save(); return $m; }
    public function createMany(array $records): Collection { return new Collection(array_map(fn ($r) => $this->create($r), $records)); }
    public function save(Model $m): Model { $m->setAttribute($this->plainFk(), $this->parent->getAttribute($this->localKey)); $m->save(); return $m; }
    public function saveMany(array $models): array { foreach ($models as $m) $this->save($m); return $models; }
}

class HasOne extends HasMany
{
    public function initRelation(array $models, string $relation): array { foreach ($models as $m) $m->setRelation($relation, null); return $models; }
    public function match(array $models, Collection $results, string $relation): array
    {
        $dict = [];
        foreach ($results as $r) $dict[$r->getAttribute($this->plainFk())] ??= $r;
        foreach ($models as $m) $m->setRelation($relation, $dict[$m->getAttribute($this->localKey)] ?? null);
        return $models;
    }
    public function getResults() { return $this->parent->getAttribute($this->localKey) === null ? null : $this->query->first(); }
}

class BelongsTo extends Relation
{
    public function __construct(Builder $query, Model $child, protected string $foreignKey, protected string $ownerKey, protected string $relationName) { parent::__construct($query, $child); }
    public function addConstraints(): void { $this->query->where($this->getRelated()->getTable() . '.' . $this->ownerKey, '=', $this->parent->getAttribute($this->foreignKey)); }
    public function addEagerConstraints(array $models): void { $this->query->whereIn($this->getRelated()->getTable() . '.' . $this->ownerKey, $this->keys($models, $this->foreignKey)); }
    public function initRelation(array $models, string $relation): array { foreach ($models as $m) $m->setRelation($relation, null); return $models; }
    public function match(array $models, Collection $results, string $relation): array
    {
        $dict = [];
        foreach ($results as $r) $dict[$r->getAttribute($this->ownerKey)] = $r;
        foreach ($models as $m) $m->setRelation($relation, $dict[$m->getAttribute($this->foreignKey)] ?? null);
        return $models;
    }
    public function getResults() { return $this->parent->getAttribute($this->foreignKey) === null ? null : $this->query->first(); }
    public function getParentKeyName(): string { return $this->foreignKey; }
    public function getRelationExistenceQuery(): Builder
    {
        return $this->getRelated()->newQuery()->whereColumn($this->getRelated()->getTable() . '.' . $this->ownerKey, '=', $this->parent->getTable() . '.' . $this->foreignKey);
    }
    public function associate($model): Model
    {
        $this->parent->setAttribute($this->foreignKey, $model instanceof Model ? $model->getAttribute($this->ownerKey) : $model);
        $this->parent->setRelation($this->relationName, $model instanceof Model ? $model : null);
        return $this->parent;
    }
    public function dissociate(): Model { $this->parent->setAttribute($this->foreignKey, null); $this->parent->setRelation($this->relationName, null); return $this->parent; }
}

class BelongsToMany extends Relation
{
    public function __construct(Builder $query, Model $parent, protected string $pivotTable, protected string $foreignPivotKey, protected string $relatedPivotKey) { parent::__construct($query, $parent); }
    protected function related(): Model { return $this->getRelated(); }
    protected function joinPivot(): void
    {
        $t = $this->related()->getTable();
        $this->query->getQuery()->join($this->pivotTable, $t . '.' . $this->related()->getKeyName(), '=', $this->pivotTable . '.' . $this->relatedPivotKey);
    }
    public function addConstraints(): void { $this->joinPivot(); $this->query->where($this->pivotTable . '.' . $this->foreignPivotKey, '=', $this->parent->getKey()); }
    public function addEagerConstraints(array $models): void { $this->joinPivot(); $this->query->whereIn($this->pivotTable . '.' . $this->foreignPivotKey, $this->keys($models, $this->parent->getKeyName())); }
    public function getEager(): Collection
    {
        $t = $this->related()->getTable();
        $this->query->getQuery()->columns = [$t . '.*', $this->pivotTable . '.' . $this->foreignPivotKey . ' as pivot_' . $this->foreignPivotKey];
        return $this->query->get(['*']);
    }
    public function getResults() { return $this->getEager(); }
    public function initRelation(array $models, string $relation): array { foreach ($models as $m) $m->setRelation($relation, new Collection); return $models; }
    public function match(array $models, Collection $results, string $relation): array
    {
        $dict = [];
        foreach ($results as $r) { $dict[$r->getAttribute('pivot_' . $this->foreignPivotKey)][] = $r; }
        foreach ($models as $m) $m->setRelation($relation, new Collection($dict[$m->getKey()] ?? []));
        return $models;
    }
    public function getRelationExistenceQuery(): Builder
    {
        $t = $this->related()->getTable();
        return $this->related()->newQuery()->join($this->pivotTable, $t . '.' . $this->related()->getKeyName(), '=', $this->pivotTable . '.' . $this->relatedPivotKey)
            ->whereColumn($this->pivotTable . '.' . $this->foreignPivotKey, '=', $this->parent->getTable() . '.' . $this->parent->getKeyName());
    }
    public function getCountsForModels(array $models): array
    {
        $ids = $this->keys($models, $this->parent->getKeyName());
        if (!$ids) return [];
        $conn = $this->parent->getConnection();
        $rows = $conn->table($this->pivotTable)->select([$this->foreignPivotKey . ' as fk', new \Illuminate\Database\Expression('count(*) as c')])->whereIn($this->foreignPivotKey, $ids)->groupBy($this->foreignPivotKey)->getRows();
        $out = [];
        foreach ($rows as $r) $out[$r['fk']] = (int) $r['c'];
        return $out;
    }
    protected function ids($ids): array
    {
        if ($ids instanceof Model) return [$ids->getKey()];
        if ($ids instanceof \Illuminate\Support\Collection) $ids = $ids->all();
        return array_map(fn ($i) => $i instanceof Model ? $i->getKey() : $i, (array) $ids);
    }
    protected function pivot() { return $this->parent->getConnection()->table($this->pivotTable); }
    public function attach($ids, array $attributes = []): void
    {
        foreach ($this->ids($ids) as $id) {
            if ($this->pivot()->where($this->foreignPivotKey, $this->parent->getKey())->where($this->relatedPivotKey, $id)->exists()) continue;
            $this->pivot()->insert([$this->foreignPivotKey => $this->parent->getKey(), $this->relatedPivotKey => $id] + $attributes);
        }
    }
    public function detach($ids = null): int
    {
        $q = $this->pivot()->where($this->foreignPivotKey, $this->parent->getKey());
        if ($ids !== null) $q->whereIn($this->relatedPivotKey, $this->ids($ids));
        return $q->delete();
    }
    public function sync($ids, bool $detaching = true): array
    {
        $want = $this->ids($ids);
        $have = $this->pivot()->where($this->foreignPivotKey, $this->parent->getKey())->pluck($this->relatedPivotKey)->all();
        $detach = array_values(array_diff($have, $want));
        if ($detaching && $detach) $this->detach($detach);
        $attach = array_values(array_diff($want, $have));
        $this->attach($attach);
        return ['attached' => $attach, 'detached' => $detaching ? $detach : [], 'updated' => []];
    }
    public function syncWithoutDetaching($ids): array { return $this->sync($ids, false); }
    public function toggle($ids): array
    {
        $have = $this->pivot()->where($this->foreignPivotKey, $this->parent->getKey())->pluck($this->relatedPivotKey)->all();
        $want = $this->ids($ids);
        $detach = array_values(array_intersect($want, $have)); $attach = array_values(array_diff($want, $have));
        if ($detach) $this->detach($detach);
        $this->attach($attach);
        return ['attached' => $attach, 'detached' => $detach];
    }
    public function create(array $attrs = [], array $pivot = []): Model { $m = $this->getRelated()->newInstance($attrs); $m->save(); $this->attach($m->getKey(), $pivot); return $m; }
}

}

namespace Illuminate\Http\Resources {
    class MissingValue {}
    class MergeValue { public function __construct(public array $data) {} }
}

namespace Illuminate\Http\Resources\Json {

use Illuminate\Http\Request;
use Illuminate\Http\Resources\MergeValue;
use Illuminate\Http\Resources\MissingValue;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

class JsonResource implements \JsonSerializable, \ArrayAccess
{
    public static ?string $wrap = 'data';
    public array $additional = [];
    public function __construct(public $resource) {}
    public static function collection($resource): AnonymousResourceCollection { return new AnonymousResourceCollection($resource, static::class); }
    public static function withoutWrapping(): void { static::$wrap = null; }
    public function toArray(Request $request)
    {
        if ($this->resource === null) return [];
        return is_array($this->resource) ? $this->resource : $this->resource->toArray();
    }
    public function additional(array $data): static { $this->additional = $data; return $this; }
    public function with(Request $request): array { return []; }
    public function resolve($request = null)
    {
        $request ??= \request();
        $data = $this->toArray($request);
        if ($data instanceof Collection) $data = $data->all();
        return $this->filter($data);
    }
    protected function filter(array $data): array
    {
        $out = [];
        foreach ($data as $k => $v) {
            if ($v instanceof MissingValue) continue;
            if ($v instanceof MergeValue) { foreach ($this->filter($v->data) as $mk => $mv) is_int($mk) ? $out[] = $mv : $out[$mk] = $mv; continue; }
            if ($v instanceof ResourceCollection) { if ($v->resource instanceof MissingValue) continue; $v = $v->resolve(); }
            elseif ($v instanceof JsonResource) $v = $v->resolve();
            elseif (is_array($v)) $v = $this->filter($v);
            $out[$k] = $v;
        }
        return $out;
    }
    public function toResponse($request = null): array
    {
        $payload = static::$wrap ? [static::$wrap => $this->resolve($request)] : $this->resolve($request);
        return array_merge($payload, $this->with($request ?? \request()), $this->additional);
    }
    public function jsonSerialize(): mixed { return $this->toResponse(); }
    public function when($cond, $value, $default = null) { if ($cond) return value($value); return func_num_args() === 3 ? value($default) : new MissingValue; }
    public function mergeWhen($cond, $value) { return $cond ? new MergeValue(value($value)) : new MissingValue; }
    public function whenLoaded(string $rel, $value = null, $default = null)
    {
        if (!$this->resource->relationLoaded($rel)) return func_num_args() === 3 ? value($default) : new MissingValue;
        $r = $this->resource->getRelation($rel) ?? $this->resource->$rel;
        if (func_num_args() === 1) return $r;
        return $r === null ? null : value($value);
    }
    public function whenCounted(string $rel, $value = null) { $k = \Illuminate\Support\Str::snake($rel) . '_count'; return array_key_exists($k, $this->resource->getAttributes()) ? ($value === null ? $this->resource->$k : value($value)) : new MissingValue; }
    public function whenNotNull($v) { return $v === null ? new MissingValue : value($v); }
    public function __get($k) { return $this->resource->$k ?? null; }
    public function __isset($k): bool { return isset($this->resource->$k); }
    public function __call($m, $a) { return $this->resource->$m(...$a); }
    public function offsetExists(mixed $k): bool { return isset($this->resource[$k]); }
    public function offsetGet(mixed $k): mixed { return $this->resource[$k]; }
    public function offsetSet(mixed $k, mixed $v): void {}
    public function offsetUnset(mixed $k): void {}
}

class ResourceCollection extends JsonResource
{
    public string $collects = '';
    public function __construct($resource, ?string $collects = null)
    {
        if ($collects) $this->collects = $collects;
        parent::__construct($resource);
    }
    protected function items(): array
    {
        $r = $this->resource instanceof LengthAwarePaginator ? $this->resource->getCollection() : $this->resource;
        $cls = $this->collects ?: JsonResource::class;
        return array_map(fn ($i) => new $cls($i), $r instanceof Collection ? $r->all() : (array) $r);
    }
    public function toArray(Request $request) { return array_map(fn ($i) => $i->resolve($request), $this->items()); }
    public function resolve($request = null) { $request ??= \request(); return $this->toArray($request); }
    public function toResponse($request = null): array
    {
        $request ??= \request();
        $out = [static::$wrap ?: 'data' => $this->resolve($request)];
        if ($this->resource instanceof LengthAwarePaginator) {
            $p = $this->resource->toArray();
            $out['links'] = ['first' => $p['first_page_url'], 'last' => $p['last_page_url'], 'prev' => $p['prev_page_url'], 'next' => $p['next_page_url']];
            $out['meta'] = ['current_page' => $p['current_page'], 'from' => $p['from'], 'last_page' => $p['last_page'], 'links' => $p['links'], 'path' => $p['path'], 'per_page' => $p['per_page'], 'to' => $p['to'], 'total' => $p['total']];
        }
        return array_merge($out, $this->additional);
    }
}

class AnonymousResourceCollection extends ResourceCollection {}

}
