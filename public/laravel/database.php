<?php
// Laravel-style mini framework: database connection, query builder, Eloquent models and relations, pagination, API resources.

namespace Illuminate\Database {

use PDO;

class QueryException extends \RuntimeException
{
    public function __construct(public string $sql, public array $bindings, \Throwable $previous)
    {
        parent::__construct($previous->getMessage() . ' (Connection: ' . \config('database.default', 'mysql') . ', SQL: ' . $sql . ')', 0, $previous);
    }
}

class Expression
{
    public function __construct(public string $value) {}
    public function __toString(): string { return $this->value; }
}

class Connection
{
    public PDO $pdo;
    public array $queryLog = [];
    protected int $transactions = 0;

    public function __construct(public string $database)
    {
        $path = PG_ROOT . "/db/{$database}.sqlite";
        $this->pdo = new PDO('sqlite:' . $path);
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        $this->registerMysqlFunctions();
    }

    // The data lives in SQLite; these make the most common MySQL/MariaDB functions work in raw queries (DB::raw, selectRaw, whereRaw).
    protected function registerMysqlFunctions(): void
    {
        $f = fn (string $name, callable $fn, int $args = -1) => $this->pdo->sqliteCreateFunction($name, $fn, $args);
        $time = fn ($v) => $v === null ? null : (is_numeric($v) ? (int) $v : strtotime((string) $v));
        $f('CONCAT', fn (...$a) => in_array(null, $a, true) ? null : implode('', $a));
        $f('CONCAT_WS', fn ($sep, ...$a) => implode((string) $sep, array_filter($a, fn ($x) => $x !== null)));
        $f('NOW', fn () => gmdate('Y-m-d H:i:s'), 0);
        $f('CURDATE', fn () => gmdate('Y-m-d'), 0);
        $f('CURTIME', fn () => gmdate('H:i:s'), 0);
        $f('DATE_FORMAT', function ($v, $fmt) use ($time) {
            $t = $time($v);
            if ($t === null || $t === false) return null;
            $map = ['Y' => 'Y', 'y' => 'y', 'm' => 'm', 'c' => 'n', 'd' => 'd', 'e' => 'j', 'H' => 'H', 'h' => 'h', 'I' => 'h', 'i' => 'i', 's' => 's', 'S' => 's', 'M' => 'F', 'b' => 'M', 'W' => 'l', 'a' => 'D', 'p' => 'A'];
            return preg_replace_callback('/%(.)/', fn ($m) => $m[1] === 'j' ? str_pad((string) (date('z', $t) + 1), 3, '0', STR_PAD_LEFT) : ($m[1] === '%' ? '%' : (isset($map[$m[1]]) ? gmdate($map[$m[1]], $t) : $m[0])), (string) $fmt);
        }, 2);
        foreach (['YEAR' => 'Y', 'MONTH' => 'n', 'DAY' => 'j', 'DAYOFMONTH' => 'j', 'HOUR' => 'G', 'MINUTE' => 'i', 'SECOND' => 's'] as $n => $c) $f($n, fn ($v) => ($t = $time($v)) ? (int) gmdate($c, $t) : null, 1);
        $f('DAYNAME', fn ($v) => ($t = $time($v)) ? gmdate('l', $t) : null, 1);
        $f('MONTHNAME', fn ($v) => ($t = $time($v)) ? gmdate('F', $t) : null, 1);
        $f('DATEDIFF', fn ($a, $b) => ($x = $time($a)) && ($y = $time($b)) ? intdiv($x - $y, 86400) : null, 2);
        $f('IF', fn ($c, $a, $b) => $c ? $a : $b, 3);
        $f('LEFT', fn ($s, $n) => $s === null ? null : mb_substr((string) $s, 0, max(0, (int) $n)), 2);
        $f('RIGHT', fn ($s, $n) => $s === null ? null : ((int) $n <= 0 ? '' : mb_substr((string) $s, -(int) $n)), 2);
        $f('CHAR_LENGTH', fn ($s) => $s === null ? null : mb_strlen((string) $s), 1);
        $f('LPAD', fn ($s, $n, $p) => $s === null ? null : mb_substr(str_pad((string) $s, (int) $n, (string) $p, STR_PAD_LEFT), 0, (int) $n), 3);
        $f('RPAD', fn ($s, $n, $p) => $s === null ? null : mb_substr(str_pad((string) $s, (int) $n, (string) $p, STR_PAD_RIGHT), 0, (int) $n), 3);
        $f('REVERSE', fn ($s) => $s === null ? null : strrev((string) $s), 1);
        $f('FORMAT', fn ($x, $d = 0) => $x === null ? null : number_format((float) $x, (int) $d), -1);
        $f('FLOOR', fn ($x) => $x === null ? null : (int) floor((float) $x), 1);
        $f('CEIL', fn ($x) => $x === null ? null : (int) ceil((float) $x), 1);
        $f('CEILING', fn ($x) => $x === null ? null : (int) ceil((float) $x), 1);
        $f('POWER', fn ($a, $b) => $a === null ? null : (float) $a ** (float) $b, 2);
        $f('POW', fn ($a, $b) => $a === null ? null : (float) $a ** (float) $b, 2);
        $f('MOD', fn ($a, $b) => $b ? $a % $b : null, 2);
        $f('RAND', fn () => mt_rand() / mt_getrandmax(), 0);
        $f('UUID', fn () => \Illuminate\Support\Str::uuid(), 0);
        $f('REGEXP', fn ($pat, $s) => $s === null ? null : (int) (bool) @preg_match('/' . str_replace('/', '\\/', (string) $pat) . '/i', (string) $s), 2);
    }

    protected function prepareBindings(array $b): array
    {
        return array_map(function ($v) {
            if (is_bool($v)) return $v ? 1 : 0;
            if ($v instanceof \DateTimeInterface) return $v->format('Y-m-d H:i:s');
            if (is_array($v) || $v instanceof \JsonSerializable) return json_encode($v);
            return $v;
        }, array_values($b));
    }

    protected function run(string $sql, array $bindings, callable $cb)
    {
        $start = microtime(true);
        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($this->prepareBindings($bindings));
            $r = $cb($stmt);
        } catch (\PDOException $e) {
            $this->queryLog[] = ['query' => $sql, 'bindings' => $bindings, 'time' => round((microtime(true) - $start) * 1000, 2), 'error' => $e->getMessage()];
            throw new QueryException($sql, $bindings, $e);
        }
        $this->queryLog[] = ['query' => $sql, 'bindings' => $bindings, 'time' => round((microtime(true) - $start) * 1000, 2)];
        return $r;
    }

    public function select(string $sql, array $bindings = []): array { return array_map(fn ($r) => (object) $r, $this->run($sql, $bindings, fn ($s) => $s->fetchAll())); }
    public function selectRows(string $sql, array $bindings = []): array { return $this->run($sql, $bindings, fn ($s) => $s->fetchAll()); }
    public function selectOne(string $sql, array $bindings = []) { return $this->select($sql, $bindings)[0] ?? null; }
    public function scalar(string $sql, array $bindings = []) { $r = $this->selectRows($sql, $bindings)[0] ?? null; return $r ? reset($r) : null; }
    public function insert(string $sql, array $bindings = []): bool { return $this->run($sql, $bindings, fn () => true); }
    public function update(string $sql, array $bindings = []): int { return $this->run($sql, $bindings, fn ($s) => $s->rowCount()); }
    public function delete(string $sql, array $bindings = []): int { return $this->run($sql, $bindings, fn ($s) => $s->rowCount()); }
    public function statement(string $sql, array $bindings = []): bool { return $this->run($sql, $bindings, fn () => true); }
    public function unprepared(string $sql): bool { $this->queryLog[] = ['query' => $sql, 'bindings' => [], 'time' => 0]; $this->pdo->exec($sql); return true; }
    public function lastInsertId() { return $this->pdo->lastInsertId(); }
    public function table(string|Expression $t, ?string $as = null): Query\Builder { return (new Query\Builder($this))->from($t, $as); }
    public function raw(string $v): Expression { return new Expression($v); }
    public function beginTransaction(): void { if ($this->transactions++ === 0) $this->pdo->beginTransaction(); }
    public function commit(): void { if (--$this->transactions === 0) $this->pdo->commit(); }
    public function rollBack(): void { if ($this->transactions > 0) { $this->transactions = 0; $this->pdo->rollBack(); } }
    public function transaction(callable $cb)
    {
        $this->beginTransaction();
        try { $r = $cb($this); $this->commit(); return $r; } catch (\Throwable $e) { $this->rollBack(); throw $e; }
    }
    public function getQueryLog(): array { return $this->queryLog; }
    public function getDatabaseName(): string { return $this->database; }
    public function getTables(): array { return array_map(fn ($r) => $r['name'], $this->selectRows("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")); }
}

}

namespace Illuminate\Database\Query {

use Illuminate\Database\Connection;
use Illuminate\Database\Expression;
use Illuminate\Support\Collection;

class Builder
{
    public ?string $from = null;
    public array $columns = [];
    public array $wheres = [];
    public array $joins = [];
    public array $orders = [];
    public array $groups = [];
    public array $havings = [];
    public ?int $limitValue = null;
    public ?int $offsetValue = null;
    public bool $distinctValue = false;

    public function __construct(public Connection $connection) {}

    public function from($table, ?string $as = null): static { $this->from = $table instanceof Expression ? (string) $table : ($as ? "$table as $as" : $table); return $this; }
    public function select(...$cols): static { $this->columns = is_array($cols[0] ?? null) ? $cols[0] : $cols; return $this; }
    public function addSelect(...$cols): static { $this->columns = array_merge($this->columns, is_array($cols[0] ?? null) ? $cols[0] : $cols); return $this; }
    public function selectRaw(string $e, array $b = []): static { $this->columns[] = new Expression($e); return $this; }
    public function distinct(): static { $this->distinctValue = true; return $this; }

    public function wrap($v): string
    {
        if ($v instanceof Expression) return (string) $v;
        $v = (string) $v;
        if (preg_match('/\s+as\s+/i', $v)) { [$a, $b] = preg_split('/\s+as\s+/i', $v, 2); return $this->wrap($a) . ' as "' . $b . '"'; }
        if (preg_match('/[(),\s]/', $v)) return $v;
        return implode('.', array_map(fn ($s) => $s === '*' ? '*' : '"' . str_replace('"', '""', $s) . '"', explode('.', $v)));
    }
    protected function wrapTable(string $t): string
    {
        if (preg_match('/^(.+?)\s+as\s+(\S+)$/i', $t, $m)) return $this->wrap($m[1]) . ' as ' . $this->wrap($m[2]);
        return $this->wrap($t);
    }

    public function where($column, $operator = null, $value = null, string $boolean = 'and'): static
    {
        $two = func_num_args() === 2;
        if (is_array($column)) { foreach ($column as $k => $v) is_array($v) ? $this->where(...$v) : $this->where($k, '=', $v, $boolean); return $this; }
        if ($column instanceof \Closure) {
            $nested = (new static($this->connection))->from($this->from);
            $column($nested);
            $this->wheres[] = ['type' => 'nested', 'query' => $nested, 'boolean' => $boolean];
            return $this;
        }
        if ($two) { $value = $operator; $operator = '='; }
        if ($operator === null) $operator = '=';
        if ($value === null) return $this->whereNull($column, $boolean, in_array($operator, ['!=', '<>'], true));
        $this->wheres[] = ['type' => 'basic', 'column' => $column, 'operator' => $operator, 'value' => $value, 'boolean' => $boolean];
        return $this;
    }
    public function orWhere($column, $operator = null, $value = null): static
    {
        if (func_num_args() === 2) { $value = $operator; $operator = '='; }
        if (is_array($column) || $column instanceof \Closure) return $this->where($column, null, null, 'or');
        return $this->where($column, $operator, $value, 'or');
    }
    public function whereIn($column, $values, string $boolean = 'and', bool $not = false): static
    {
        $this->wheres[] = ['type' => 'in', 'column' => $column, 'values' => $values instanceof Collection ? $values->all() : (array) $values, 'boolean' => $boolean, 'not' => $not];
        return $this;
    }
    public function whereNotIn($column, $values): static { return $this->whereIn($column, $values, 'and', true); }
    public function orWhereIn($column, $values): static { return $this->whereIn($column, $values, 'or'); }
    public function whereNull($column, string $boolean = 'and', bool $not = false): static { $this->wheres[] = ['type' => 'null', 'column' => $column, 'boolean' => $boolean, 'not' => $not]; return $this; }
    public function whereNotNull($column): static { return $this->whereNull($column, 'and', true); }
    public function orWhereNull($column): static { return $this->whereNull($column, 'or'); }
    public function whereBetween($column, array $values, string $boolean = 'and', bool $not = false): static { $this->wheres[] = ['type' => 'between', 'column' => $column, 'values' => array_values($values), 'boolean' => $boolean, 'not' => $not]; return $this; }
    public function whereNotBetween($column, array $values): static { return $this->whereBetween($column, $values, 'and', true); }
    public function whereRaw(string $sql, array $bindings = [], string $boolean = 'and'): static { $this->wheres[] = ['type' => 'raw', 'sql' => $sql, 'bindings' => $bindings, 'boolean' => $boolean]; return $this; }
    public function orWhereRaw(string $sql, array $bindings = []): static { return $this->whereRaw($sql, $bindings, 'or'); }
    public function whereColumn($a, $op, $b = null): static { if ($b === null) { $b = $op; $op = '='; } $this->wheres[] = ['type' => 'column', 'first' => $a, 'operator' => $op, 'second' => $b, 'boolean' => 'and']; return $this; }
    public function whereLike($column, $value): static { return $this->where($column, 'like', $value); }
    public function whereDate($column, $op, $value = null): static { if ($value === null) { $value = $op; $op = '='; } return $this->whereRaw('date(' . $this->wrap($column) . ') ' . $op . ' ?', [$value instanceof \DateTimeInterface ? $value->format('Y-m-d') : $value]); }
    public function whereExists(callable $cb, string $boolean = 'and', bool $not = false): static
    {
        $q = new static($this->connection); $cb($q);
        $this->wheres[] = ['type' => 'exists', 'query' => $q, 'boolean' => $boolean, 'not' => $not];
        return $this;
    }
    public function when($cond, callable $cb, ?callable $else = null): static { if ($cond) { $cb($this, $cond); } elseif ($else) { $else($this, $cond); } return $this; }
    public function unless($cond, callable $cb, ?callable $else = null): static { return $this->when(!$cond, $cb, $else); }
    public function tap(callable $cb): static { $cb($this); return $this; }

    public function join(string $table, $first, ?string $op = null, ?string $second = null, string $type = 'inner'): static { $this->joins[] = compact('table', 'first', 'op', 'second', 'type'); return $this; }
    public function leftJoin(string $t, $f, ?string $o = null, ?string $s = null): static { return $this->join($t, $f, $o, $s, 'left'); }
    public function rightJoin(string $t, $f, ?string $o = null, ?string $s = null): static { return $this->join($t, $f, $o, $s, 'right'); }

    public function orderBy($column, string $direction = 'asc'): static { $this->orders[] = ['column' => $column, 'direction' => strtolower($direction) === 'desc' ? 'desc' : 'asc']; return $this; }
    public function orderByDesc($column): static { return $this->orderBy($column, 'desc'); }
    public function latest($column = 'created_at'): static { return $this->orderBy($column, 'desc'); }
    public function oldest($column = 'created_at'): static { return $this->orderBy($column, 'asc'); }
    public function inRandomOrder(): static { $this->orders[] = ['raw' => 'random()']; return $this; }
    public function orderByRaw(string $sql): static { $this->orders[] = ['raw' => $sql]; return $this; }
    public function groupBy(...$cols): static { $this->groups = array_merge($this->groups, is_array($cols[0] ?? null) ? $cols[0] : $cols); return $this; }
    public function having($column, $op, $value = null): static { if ($value === null) { $value = $op; $op = '='; } $this->havings[] = [$column, $op, $value]; return $this; }
    public function limit(int $n): static { $this->limitValue = max(0, $n); return $this; }
    public function take(int $n): static { return $this->limit($n); }
    public function offset(int $n): static { $this->offsetValue = max(0, $n); return $this; }
    public function skip(int $n): static { return $this->offset($n); }
    public function forPage(int $page, int $perPage = 15): static { return $this->offset(($page - 1) * $perPage)->limit($perPage); }

    // ----- SQL compilation -----

    protected function compileWheres(array &$bindings): string
    {
        $sql = '';
        foreach ($this->wheres as $i => $w) {
            $part = match ($w['type']) {
                'basic' => $this->wrap($w['column']) . ' ' . $w['operator'] . ' ' . $this->placeholder($w['value'], $bindings),
                'in' => (function () use ($w, &$bindings) {
                    if ($w['values'] === []) return $w['not'] ? '1 = 1' : '0 = 1';
                    $ph = [];
                    foreach ($w['values'] as $v) $ph[] = $this->placeholder($v, $bindings);
                    return $this->wrap($w['column']) . ($w['not'] ? ' not in (' : ' in (') . implode(', ', $ph) . ')';
                })(),
                'null' => $this->wrap($w['column']) . ($w['not'] ? ' is not null' : ' is null'),
                'between' => $this->wrap($w['column']) . ($w['not'] ? ' not between ' : ' between ') . $this->placeholder($w['values'][0], $bindings) . ' and ' . $this->placeholder($w['values'][1], $bindings),
                'raw' => (function () use ($w, &$bindings) { foreach ($w['bindings'] as $b) $bindings[] = $b; return $w['sql']; })(),
                'column' => $this->wrap($w['first']) . ' ' . $w['operator'] . ' ' . $this->wrap($w['second']),
                'nested' => (function () use ($w, &$bindings) { $inner = $w['query']->compileWheres($bindings); return '(' . $inner . ')'; })(),
                'exists' => (function () use ($w, &$bindings) { [$s, $b] = $w['query']->compileSelect(); foreach ($b as $x) $bindings[] = $x; return ($w['not'] ? 'not ' : '') . 'exists (' . $s . ')'; })(),
            };
            $sql .= ($i === 0 ? '' : ' ' . $w['boolean'] . ' ') . $part;
        }
        return $sql;
    }
    protected function placeholder($v, array &$bindings): string
    {
        if ($v instanceof Expression) return (string) $v;
        $bindings[] = $v;
        return '?';
    }

    public function compileSelect(): array
    {
        $b = [];
        $cols = $this->columns ?: ['*'];
        $sql = 'select ' . ($this->distinctValue ? 'distinct ' : '') . implode(', ', array_map(fn ($c) => $this->wrap($c), $cols)) . ' from ' . $this->wrapTable($this->from);
        foreach ($this->joins as $j) {
            $sql .= ' ' . $j['type'] . ' join ' . $this->wrapTable($j['table']) . ' on ' . $this->wrap($j['first']) . ' ' . ($j['op'] ?? '=') . ' ' . $this->wrap($j['second'] ?? $j['op']);
        }
        if ($this->wheres) $sql .= ' where ' . $this->compileWheres($b);
        if ($this->groups) $sql .= ' group by ' . implode(', ', array_map(fn ($g) => $this->wrap($g), $this->groups));
        if ($this->havings) { $sql .= ' having ' . implode(' and ', array_map(function ($h) use (&$b) { $b[] = $h[2]; return $this->wrap($h[0]) . ' ' . $h[1] . ' ?'; }, $this->havings)); }
        if ($this->orders) $sql .= ' order by ' . implode(', ', array_map(fn ($o) => isset($o['raw']) ? $o['raw'] : $this->wrap($o['column']) . ' ' . $o['direction'], $this->orders));
        if ($this->limitValue !== null) $sql .= ' limit ' . $this->limitValue;
        if ($this->offsetValue !== null) $sql .= ($this->limitValue === null ? ' limit -1' : '') . ' offset ' . $this->offsetValue;
        return [$sql, $b];
    }
    public function toSql(): string { return $this->compileSelect()[0]; }
    public function getBindings(): array { return $this->compileSelect()[1]; }
    public function dump(): static { echo $this->toSql() . "\n"; return $this; }
    public function dd(): never { \dd($this->toSql(), $this->getBindings()); }

    // ----- execution -----

    public function get($columns = null): Collection
    {
        if ($columns) $this->columns = is_array($columns) ? $columns : [$columns];
        [$sql, $b] = $this->compileSelect();
        return new Collection($this->connection->select($sql, $b));
    }
    public function getRows(): array { [$sql, $b] = $this->compileSelect(); return $this->connection->selectRows($sql, $b); }
    public function first($columns = null) { return $this->limit(1)->get($columns)->first(); }
    public function find($id, $columns = null) { return $this->where('id', '=', $id)->first($columns); }
    public function sole() { $r = $this->limit(2)->get(); if ($r->count() !== 1) throw new \RuntimeException($r->isEmpty() ? 'No records found.' : 'Multiple records found.'); return $r->first(); }
    public function value($column) { $r = $this->first([$column]); return $r ? ((array) $r)[preg_replace('/^.*\./', '', $column)] ?? null : null; }
    public function pluck($column, $key = null): Collection
    {
        $col = preg_replace('/^.*\s+as\s+/i', '', preg_replace('/^.*\./', '', $column));
        $rows = $this->get($key ? [$column, $key] : [$column]);
        $kc = $key ? preg_replace('/^.*\./', '', $key) : null;
        return $rows->pluck($col, $kc);
    }
    protected function aggregate(string $fn, string $column = '*')
    {
        $c = clone $this;
        $c->columns = [new Expression($fn . '(' . ($column === '*' ? '*' : $this->wrap($column)) . ') as aggregate')];
        $c->orders = []; $c->limitValue = null; $c->offsetValue = null;
        $r = $c->get()->first();
        return $r ? $r->aggregate : null;
    }
    public function count($columns = '*'): int { return (int) $this->aggregate('count', is_array($columns) ? $columns[0] : $columns); }
    public function sum($column) { return $this->aggregate('sum', $column) ?? 0; }
    public function avg($column) { return $this->aggregate('avg', $column); }
    public function average($column) { return $this->avg($column); }
    public function min($column) { return $this->aggregate('min', $column); }
    public function max($column) { return $this->aggregate('max', $column); }
    public function exists(): bool { return $this->count() > 0; }
    public function doesntExist(): bool { return !$this->exists(); }

    public function insert(array $values): bool
    {
        if ($values === []) return true;
        if (!is_array(reset($values))) $values = [$values];
        $cols = array_keys(reset($values));
        $sql = 'insert into ' . $this->wrap($this->from) . ' (' . implode(', ', array_map(fn ($c) => $this->wrap($c), $cols)) . ') values ';
        $b = [];
        $rows = [];
        foreach ($values as $row) { $rows[] = '(' . implode(', ', array_fill(0, count($cols), '?')) . ')'; foreach ($cols as $c) $b[] = $row[$c] ?? null; }
        return $this->connection->insert($sql . implode(', ', $rows), $b);
    }
    public function insertGetId(array $values, $sequence = null)
    {
        $this->insert($values);
        return (int) $this->connection->lastInsertId();
    }
    public function insertOrIgnore(array $values): int { return $this->connection->update('insert or ignore into ' . $this->wrap($this->from) . ' (' . implode(', ', array_map(fn ($c) => $this->wrap($c), array_keys($values))) . ') values (' . implode(', ', array_fill(0, count($values), '?')) . ')', array_values($values)); }
    public function update(array $values): int
    {
        $b = [];
        $set = implode(', ', array_map(function ($c, $v) use (&$b) { return $this->wrap($c) . ' = ' . $this->placeholder($v, $b); }, array_keys($values), $values));
        $sql = 'update ' . $this->wrap($this->from) . ' set ' . $set;
        if ($this->wheres) $sql .= ' where ' . $this->compileWheres($b);
        return $this->connection->update($sql, $b);
    }
    public function updateOrInsert(array $attributes, array $values = []): bool
    {
        $q = clone $this;
        if (!(clone $q)->where($attributes)->exists()) return $this->insert($attributes + $values);
        if ($values) (clone $q)->where($attributes)->update($values);
        return true;
    }
    public function increment($column, $amount = 1, array $extra = []): int { return $this->update([$column => new Expression($this->wrap($column) . ' + ' . (float) $amount)] + $extra); }
    public function decrement($column, $amount = 1, array $extra = []): int { return $this->update([$column => new Expression($this->wrap($column) . ' - ' . (float) $amount)] + $extra); }
    public function delete($id = null): int
    {
        if ($id !== null) $this->where('id', '=', $id);
        $b = [];
        $sql = 'delete from ' . $this->wrap($this->from);
        if ($this->wheres) $sql .= ' where ' . $this->compileWheres($b);
        return $this->connection->delete($sql, $b);
    }
    public function truncate(): void { $this->connection->statement('delete from ' . $this->wrap($this->from)); try { $this->connection->statement('delete from sqlite_sequence where name = ?', [$this->from]); } catch (\Throwable) {} }

    public function paginate(int $perPage = 15, $columns = ['*'], string $pageName = 'page', ?int $page = null)
    {
        $page = $page ?? max(1, (int) \request()->query($pageName, 1));
        $total = (clone $this)->count();
        $items = $total ? (clone $this)->forPage($page, $perPage)->get($columns) : new Collection;
        return new \Illuminate\Pagination\LengthAwarePaginator($items, $total, $perPage, $page, ['path' => \request()->url()]);
    }
    public function simplePaginate(int $perPage = 15, $columns = ['*'], string $pageName = 'page', ?int $page = null) { return $this->paginate($perPage, $columns, $pageName, $page); }
    public function chunk(int $count, callable $cb): bool
    {
        $page = 1;
        do { $res = (clone $this)->forPage($page, $count)->get(); if ($res->isEmpty()) break; if ($cb($res, $page) === false) return false; $page++; } while ($res->count() === $count);
        return true;
    }
    public function __clone() { foreach ($this->wheres as $i => $w) if (isset($w['query'])) $this->wheres[$i]['query'] = clone $w['query']; }
}

}

namespace Illuminate\Pagination {

use Illuminate\Support\Collection;

class LengthAwarePaginator implements \JsonSerializable, \IteratorAggregate, \Countable, \ArrayAccess, \Illuminate\Contracts\Support\Arrayable
{
    public function __construct(protected $items, protected int $total, protected int $perPage, protected int $currentPage = 1, protected array $options = [])
    {
        $this->items = $items instanceof Collection ? $items : new Collection($items);
    }
    public function items(): array { return $this->items->all(); }
    public function getCollection(): Collection { return $this->items; }
    public function total(): int { return $this->total; }
    public function perPage(): int { return $this->perPage; }
    public function currentPage(): int { return $this->currentPage; }
    public function lastPage(): int { return max((int) ceil($this->total / max(1, $this->perPage)), 1); }
    public function hasMorePages(): bool { return $this->currentPage < $this->lastPage(); }
    public function url(int $page): string { return ($this->options['path'] ?? '') . '?page=' . $page; }
    public function firstItem(): ?int { return $this->items->isEmpty() ? null : ($this->currentPage - 1) * $this->perPage + 1; }
    public function lastItem(): ?int { return $this->items->isEmpty() ? null : $this->firstItem() + $this->items->count() - 1; }
    public function nextPageUrl(): ?string { return $this->hasMorePages() ? $this->url($this->currentPage + 1) : null; }
    public function previousPageUrl(): ?string { return $this->currentPage > 1 ? $this->url($this->currentPage - 1) : null; }
    public function links(): array
    {
        $last = $this->lastPage(); $cur = $this->currentPage;
        $links = [['url' => $this->previousPageUrl(), 'label' => '&laquo; Previous', 'active' => false]];
        $pages = $last <= 13 ? range(1, $last) : array_unique(array_merge([1, 2], range(max(1, $cur - 2), min($last, $cur + 2)), [$last - 1, $last]));
        $prev = 0;
        foreach ($pages as $p) {
            if ($p - $prev > 1) $links[] = ['url' => null, 'label' => '...', 'active' => false];
            $links[] = ['url' => $this->url($p), 'label' => (string) $p, 'active' => $p === $cur];
            $prev = $p;
        }
        $links[] = ['url' => $this->nextPageUrl(), 'label' => 'Next &raquo;', 'active' => false];
        return $links;
    }
    public function toArray(): array
    {
        return [
            'current_page' => $this->currentPage, 'data' => $this->items->toArray(), 'first_page_url' => $this->url(1), 'from' => $this->firstItem(),
            'last_page' => $this->lastPage(), 'last_page_url' => $this->url($this->lastPage()), 'links' => $this->links(), 'next_page_url' => $this->nextPageUrl(),
            'path' => $this->options['path'] ?? '', 'per_page' => $this->perPage, 'prev_page_url' => $this->previousPageUrl(), 'to' => $this->lastItem(), 'total' => $this->total,
        ];
    }
    public function jsonSerialize(): array { return $this->toArray(); }
    public function getIterator(): \ArrayIterator { return $this->items->getIterator(); }
    public function count(): int { return $this->items->count(); }
    public function offsetExists(mixed $k): bool { return isset($this->items[$k]); }
    public function offsetGet(mixed $k): mixed { return $this->items[$k]; }
    public function offsetSet(mixed $k, mixed $v): void {}
    public function offsetUnset(mixed $k): void {}
    public function __call($m, $a) { return $this->items->$m(...$a); }
}

}
