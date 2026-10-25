<?php
// Laravel-style mini framework: schema builder, migrations, seeders, model factories and a small Faker.

namespace Illuminate\Database\Schema {

use Illuminate\Database\Connection;
use Illuminate\Database\Expression;

class ColumnDefinition
{
    public array $attributes = [];
    public function __construct(array $attributes = []) { $this->attributes = $attributes; }
    public function __get($k) { return $this->attributes[$k] ?? null; }
    public function nullable(bool $v = true): static { $this->attributes['nullable'] = $v; return $this; }
    public function default($v): static { $this->attributes['default'] = $v; $this->attributes['hasDefault'] = true; return $this; }
    public function useCurrent(): static { return $this->default(new Expression('CURRENT_TIMESTAMP')); }
    public function useCurrentOnUpdate(): static { return $this; }
    public function unique(?string $name = null): static { $this->attributes['unique'] = true; return $this; }
    public function index(?string $name = null): static { $this->attributes['index'] = true; return $this; }
    public function primary(): static { $this->attributes['primary'] = true; return $this; }
    public function unsigned(): static { $this->attributes['unsigned'] = true; return $this; }
    public function autoIncrement(): static { $this->attributes['autoIncrement'] = true; return $this; }
    public function comment(string $c): static { return $this; }
    public function after(string $c): static { return $this; }
    public function first(): static { return $this; }
    public function charset(string $c): static { return $this; }
    public function collation(string $c): static { return $this; }
    public function change(): static { throw new \RuntimeException('Changing a column is not supported by this playground: drop and re-create the column instead.'); }
    // foreign key helpers (foreignId()->constrained()->cascadeOnDelete())
    public function constrained(?string $table = null, string $column = 'id'): static
    {
        $this->attributes['foreign'] = ['table' => $table ?? \Illuminate\Support\Str::plural(preg_replace('/_id$/', '', $this->attributes['name'])), 'column' => $column, 'onDelete' => null, 'onUpdate' => null];
        return $this;
    }
    public function references(string $col): static { $this->attributes['foreign'] = ($this->attributes['foreign'] ?? ['table' => null, 'onDelete' => null, 'onUpdate' => null]) + []; $this->attributes['foreign']['column'] = $col; return $this; }
    public function on(string $table): static { $this->attributes['foreign']['table'] = $table; return $this; }
    public function onDelete(string $a): static { $this->attributes['foreign']['onDelete'] = $a; return $this; }
    public function onUpdate(string $a): static { $this->attributes['foreign']['onUpdate'] = $a; return $this; }
    public function cascadeOnDelete(): static { return $this->onDelete('cascade'); }
    public function restrictOnDelete(): static { return $this->onDelete('restrict'); }
    public function nullOnDelete(): static { return $this->onDelete('set null'); }
    public function cascadeOnUpdate(): static { return $this->onUpdate('cascade'); }
}

class Blueprint
{
    public array $columns = [];
    public array $indexes = [];
    public array $foreigns = [];
    public array $drops = [];
    public array $renames = [];

    public function __construct(public string $table) {}

    protected function addColumn(string $type, string $name, array $extra = []): ColumnDefinition
    {
        $c = new ColumnDefinition(['type' => $type, 'name' => $name] + $extra);
        $this->columns[] = $c;
        return $c;
    }
    public function id(string $name = 'id'): ColumnDefinition { return $this->addColumn('bigInteger', $name, ['autoIncrement' => true, 'primary' => true, 'unsigned' => true]); }
    public function bigIncrements(string $n): ColumnDefinition { return $this->id($n); }
    public function increments(string $n): ColumnDefinition { return $this->addColumn('integer', $n, ['autoIncrement' => true, 'primary' => true, 'unsigned' => true]); }
    public function string(string $n, int $len = 255): ColumnDefinition { return $this->addColumn('string', $n, ['length' => $len]); }
    public function char(string $n, int $len = 255): ColumnDefinition { return $this->addColumn('char', $n, ['length' => $len]); }
    public function text(string $n): ColumnDefinition { return $this->addColumn('text', $n); }
    public function mediumText(string $n): ColumnDefinition { return $this->addColumn('text', $n); }
    public function longText(string $n): ColumnDefinition { return $this->addColumn('text', $n); }
    public function integer(string $n): ColumnDefinition { return $this->addColumn('integer', $n); }
    public function tinyInteger(string $n): ColumnDefinition { return $this->addColumn('tinyint', $n); }
    public function smallInteger(string $n): ColumnDefinition { return $this->addColumn('smallint', $n); }
    public function mediumInteger(string $n): ColumnDefinition { return $this->addColumn('mediumint', $n); }
    public function bigInteger(string $n): ColumnDefinition { return $this->addColumn('bigInteger', $n); }
    public function unsignedInteger(string $n): ColumnDefinition { return $this->addColumn('integer', $n, ['unsigned' => true]); }
    public function unsignedTinyInteger(string $n): ColumnDefinition { return $this->addColumn('tinyint', $n, ['unsigned' => true]); }
    public function unsignedSmallInteger(string $n): ColumnDefinition { return $this->addColumn('smallint', $n, ['unsigned' => true]); }
    public function unsignedBigInteger(string $n): ColumnDefinition { return $this->addColumn('bigInteger', $n, ['unsigned' => true]); }
    public function foreignId(string $n): ColumnDefinition { return $this->addColumn('bigInteger', $n, ['unsigned' => true]); }
    public function boolean(string $n): ColumnDefinition { return $this->addColumn('boolean', $n); }
    public function decimal(string $n, int $p = 8, int $s = 2): ColumnDefinition { return $this->addColumn('decimal', $n, ['precision' => $p, 'scale' => $s]); }
    public function double(string $n): ColumnDefinition { return $this->addColumn('double', $n); }
    public function float(string $n): ColumnDefinition { return $this->addColumn('float', $n); }
    public function date(string $n): ColumnDefinition { return $this->addColumn('date', $n); }
    public function dateTime(string $n): ColumnDefinition { return $this->addColumn('datetime', $n); }
    public function dateTimeTz(string $n): ColumnDefinition { return $this->addColumn('datetime', $n); }
    public function time(string $n): ColumnDefinition { return $this->addColumn('time', $n); }
    public function timestamp(string $n): ColumnDefinition { return $this->addColumn('timestamp', $n); }
    public function year(string $n): ColumnDefinition { return $this->addColumn('year', $n); }
    public function json(string $n): ColumnDefinition { return $this->addColumn('json', $n); }
    public function jsonb(string $n): ColumnDefinition { return $this->addColumn('json', $n); }
    public function uuid(string $n = 'uuid'): ColumnDefinition { return $this->addColumn('uuid', $n); }
    public function ulid(string $n = 'ulid'): ColumnDefinition { return $this->addColumn('char', $n, ['length' => 26]); }
    public function ipAddress(string $n = 'ip_address'): ColumnDefinition { return $this->addColumn('string', $n, ['length' => 45]); }
    public function binary(string $n): ColumnDefinition { return $this->addColumn('binary', $n); }
    public function enum(string $n, array $allowed): ColumnDefinition { return $this->addColumn('enum', $n, ['allowed' => $allowed]); }
    public function rememberToken(): ColumnDefinition { return $this->string('remember_token', 100)->nullable(); }
    public function timestamps(): void { $this->timestamp('created_at')->nullable(); $this->timestamp('updated_at')->nullable(); }
    public function softDeletes(string $n = 'deleted_at'): ColumnDefinition { return $this->timestamp($n)->nullable(); }
    public function index($cols, ?string $name = null): void { $this->indexes[] = ['cols' => (array) $cols, 'unique' => false, 'name' => $name]; }
    public function unique($cols, ?string $name = null): void { $this->indexes[] = ['cols' => (array) $cols, 'unique' => true, 'name' => $name]; }
    public function primary($cols, ?string $name = null): void { $this->indexes[] = ['cols' => (array) $cols, 'primary' => true, 'unique' => true, 'name' => $name]; }
    public function foreign($cols): ColumnDefinition { $c = new ColumnDefinition(['name' => (array) $cols, 'foreign' => ['table' => null, 'column' => 'id', 'onDelete' => null, 'onUpdate' => null]]); $this->foreigns[] = $c; return $c; }
    public function dropColumn($cols): void { foreach ((array) $cols as $c) $this->drops[] = $c; }
    public function renameColumn(string $from, string $to): void { $this->renames[] = [$from, $to]; }
    public function dropTimestamps(): void { $this->dropColumn(['created_at', 'updated_at']); }
    public function dropSoftDeletes(): void { $this->dropColumn('deleted_at'); }
    public function dropIndex($name): void { $this->drops[] = ['index' => $name]; }
    public function dropUnique($name): void { $this->drops[] = ['index' => $name]; }
}

class Schema
{
    public static function conn(): Connection { return \Illuminate\Support\Facades\DB::connection(); }
    protected static function q(string $s): string { return '"' . str_replace('"', '""', $s) . '"'; }

    protected static function typeSql(ColumnDefinition $c): string
    {
        $a = $c->attributes;
        $u = !empty($a['unsigned']) ? ' unsigned' : '';
        return match ($a['type']) {
            'string' => 'varchar(' . $a['length'] . ')', 'char' => 'char(' . $a['length'] . ')',
            'text' => 'text', 'integer' => 'integer' . $u, 'tinyint' => 'tinyint' . $u, 'smallint' => 'smallint' . $u, 'mediumint' => 'mediumint' . $u,
            'bigInteger' => 'bigint' . $u, 'boolean' => 'tinyint(1)', 'decimal' => 'decimal(' . $a['precision'] . ', ' . $a['scale'] . ')',
            'double' => 'double', 'float' => 'float', 'date' => 'date', 'datetime' => 'datetime', 'time' => 'time', 'timestamp' => 'timestamp', 'year' => 'year',
            'json' => 'text', 'uuid' => 'varchar(36)', 'binary' => 'blob', 'enum' => 'varchar(255)', default => 'text',
        };
    }
    protected static function literal($v): string
    {
        if ($v instanceof Expression) return (string) $v;
        if (is_bool($v)) return $v ? '1' : '0';
        if (is_int($v) || is_float($v)) return (string) $v;
        if ($v === null) return 'null';
        return "'" . str_replace("'", "''", (string) $v) . "'";
    }
    protected static function columnSql(ColumnDefinition $c, bool $forAlter = false): string
    {
        $a = $c->attributes;
        if (!empty($a['autoIncrement']) && !empty($a['primary'])) return self::q($a['name']) . ' integer primary key autoincrement not null';
        $sql = self::q($a['name']) . ' ' . self::typeSql($c);
        $sql .= !empty($a['nullable']) ? ' null' : ' not null';
        if (!empty($a['hasDefault'])) $sql .= ' default ' . self::literal($a['default']);
        elseif ($forAlter && empty($a['nullable'])) $sql .= ' default ' . (in_array($a['type'], ['string', 'char', 'text', 'uuid', 'enum', 'date', 'datetime', 'time', 'timestamp', 'json'], true) ? "''" : '0');
        if ($a['type'] === 'enum') $sql .= ' check (' . self::q($a['name']) . ' in (' . implode(', ', array_map([self::class, 'literal'], $a['allowed'])) . '))';
        return $sql;
    }
    protected static function fkSql(array $cols, array $f): string
    {
        return 'foreign key(' . implode(', ', array_map([self::class, 'q'], $cols)) . ') references ' . self::q($f['table']) . '(' . self::q($f['column']) . ')'
            . ($f['onDelete'] ? ' on delete ' . $f['onDelete'] : '') . ($f['onUpdate'] ? ' on update ' . $f['onUpdate'] : '');
    }

    public static function create(string $table, callable $cb): void
    {
        $bp = new Blueprint($table);
        $cb($bp);
        $parts = array_map(fn ($c) => self::columnSql($c), $bp->columns);
        $pk = array_values(array_filter($bp->indexes, fn ($i) => !empty($i['primary'])));
        if ($pk) $parts[] = 'primary key (' . implode(', ', array_map([self::class, 'q'], $pk[0]['cols'])) . ')';
        elseif ($single = array_values(array_filter($bp->columns, fn ($c) => !empty($c->attributes['primary']) && empty($c->attributes['autoIncrement'])))) $parts[] = 'primary key (' . self::q($single[0]->attributes['name']) . ')';
        foreach ($bp->columns as $c) if (!empty($c->attributes['foreign']) && $c->attributes['foreign']['table']) $parts[] = self::fkSql([$c->attributes['name']], $c->attributes['foreign']);
        foreach ($bp->foreigns as $f) $parts[] = self::fkSql($f->attributes['name'], $f->attributes['foreign']);
        self::conn()->statement('create table ' . self::q($table) . ' (' . implode(', ', $parts) . ')');
        self::indexes($bp);
    }
    protected static function indexes(Blueprint $bp): void
    {
        $t = $bp->table;
        foreach ($bp->columns as $c) {
            $n = $c->attributes['name'];
            if (!empty($c->attributes['unique'])) self::conn()->statement('create unique index ' . self::q("{$t}_{$n}_unique") . ' on ' . self::q($t) . ' (' . self::q($n) . ')');
            if (!empty($c->attributes['index'])) self::conn()->statement('create index ' . self::q("{$t}_{$n}_index") . ' on ' . self::q($t) . ' (' . self::q($n) . ')');
        }
        foreach ($bp->indexes as $i) {
            if (!empty($i['primary'])) continue;
            $name = $i['name'] ?? $t . '_' . implode('_', $i['cols']) . ($i['unique'] ? '_unique' : '_index');
            self::conn()->statement('create ' . ($i['unique'] ? 'unique ' : '') . 'index ' . self::q($name) . ' on ' . self::q($t) . ' (' . implode(', ', array_map([self::class, 'q'], $i['cols'])) . ')');
        }
    }
    public static function table(string $table, callable $cb): void
    {
        $bp = new Blueprint($table);
        $cb($bp);
        foreach ($bp->columns as $c) {
            self::conn()->statement('alter table ' . self::q($table) . ' add column ' . self::columnSql($c, true));
        }
        foreach ($bp->renames as [$a, $b]) self::conn()->statement('alter table ' . self::q($table) . ' rename column ' . self::q($a) . ' to ' . self::q($b));
        foreach ($bp->drops as $d) {
            if (is_array($d)) { $n = is_array($d['index']) ? $table . '_' . implode('_', $d['index']) . '_index' : $d['index']; self::conn()->statement('drop index if exists ' . self::q($n)); }
            else self::conn()->statement('alter table ' . self::q($table) . ' drop column ' . self::q($d));
        }
        self::indexes($bp);
    }
    public static function drop(string $t): void { self::conn()->statement('drop table ' . self::q($t)); }
    public static function dropIfExists(string $t): void { self::conn()->statement('drop table if exists ' . self::q($t)); }
    public static function rename(string $a, string $b): void { self::conn()->statement('alter table ' . self::q($a) . ' rename to ' . self::q($b)); }
    public static function hasTable(string $t): bool { return in_array($t, self::conn()->getTables(), true); }
    public static function getColumnListing(string $t): array { return array_map(fn ($r) => $r['name'], self::conn()->selectRows('pragma table_info(' . self::q($t) . ')')); }
    public static function hasColumn(string $t, string $c): bool { return in_array($c, self::getColumnListing($t), true); }
    public static function hasColumns(string $t, array $cs): bool { foreach ($cs as $c) if (!self::hasColumn($t, $c)) return false; return true; }
    public static function disableForeignKeyConstraints(): void { self::conn()->unprepared('PRAGMA foreign_keys = OFF'); }
    public static function enableForeignKeyConstraints(): void { self::conn()->unprepared('PRAGMA foreign_keys = ON'); }
    public static function withoutForeignKeyConstraints(callable $cb) { self::disableForeignKeyConstraints(); try { return $cb(); } finally { self::enableForeignKeyConstraints(); } }
}

}

namespace Illuminate\Database\Migrations {
    abstract class Migration
    {
        abstract public function up(): void;
        public function down(): void {}
    }
}

namespace Illuminate\Database {

abstract class Seeder
{
    public static array $log = [];
    abstract public function run(): void;
    public function call($classes, bool $silent = false): static
    {
        foreach ((array) $classes as $class) {
            $start = microtime(true);
            (new $class)->run();
            self::$log[] = [$class, round((microtime(true) - $start) * 1000)];
        }
        return $this;
    }
}

}

namespace Illuminate\Database\Eloquent\Factories {

use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;

trait HasFactory
{
    public static function factory(...$args)
    {
        $class = 'Database\\Factories\\' . class_basename(static::class) . 'Factory';
        if (!class_exists($class)) throw new \RuntimeException("Factory [$class] not found. Create database/factories/" . class_basename(static::class) . "Factory.php");
        $f = $class::new();
        if ($args && is_int($args[0])) $f = $f->count($args[0]);
        return $f;
    }
}

abstract class Factory
{
    protected $model = null;
    protected ?int $count = null;
    protected array $states = [];
    public $faker;

    public function __construct() { $this->faker = \fake(); }
    public static function new(array $attributes = []): static { $f = new static; return $attributes ? $f->state($attributes) : $f; }
    abstract public function definition(): array;
    public function count(?int $n): static { $c = clone $this; $c->count = $n; return $c; }
    public function state($state): static { $c = clone $this; $c->states[] = $state; return $c; }
    public function modelName(): string
    {
        if ($this->model) return $this->model;
        $base = preg_replace('/Factory$/', '', class_basename(static::class));
        return 'App\\Models\\' . $base;
    }
    protected function attributes(array $override): array
    {
        $a = $this->definition();
        foreach ($this->states as $s) $a = array_merge($a, is_callable($s) ? $s($a) : $s);
        foreach ($a as $k => $v) if (is_callable($v) && !is_string($v)) $a[$k] = $v($a);
        return array_merge($a, $override);
    }
    public function make(array $override = [])
    {
        $class = $this->modelName();
        $make = fn () => (new $class)->forceFill($this->attributes($override));
        if ($this->count === null) return $make();
        return new Collection(array_map(fn () => $make(), range(1, $this->count)));
    }
    public function create(array $override = [])
    {
        $r = $this->make($override);
        if ($r instanceof Model) { $r->save(); return $r; }
        foreach ($r as $m) $m->save();
        return $r;
    }
    public function createMany(int $n): Collection { return $this->count($n)->create(); }
    public function sequence(...$seq): static { $i = 0; return $this->state(function () use ($seq, &$i) { return $seq[$i++ % count($seq)]; }); }
}

}

namespace Faker {

class Generator
{
    protected array $used = [];
    protected const FIRST = ['Aarav', 'Asha', 'Ben', 'Chen', 'Dana', 'Eli', 'Fatima', 'Gabe', 'Hana', 'Ishaan', 'Jia', 'Kofi', 'Lena', 'Mateo', 'Nina', 'Omar', 'Priya', 'Quinn', 'Ravi', 'Sofia', 'Tariq', 'Uma', 'Victor', 'Wen', 'Yusuf', 'Zara', 'Anil', 'Diya', 'Rohan', 'Sneha'];
    protected const LAST = ['Sharma', 'Miller', 'Wang', 'Fischer', 'Cohen', 'Khan', 'Silva', 'Tanaka', 'Petrov', 'Lin', 'Mensah', 'Berg', 'Garcia', 'Rossi', 'Haddad', 'Patel', 'Nguyen', 'Okafor', 'Novak', 'Lopez', 'Gupta', 'Das', 'Singh', 'Kumar'];
    protected const WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate', 'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint', 'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum'];
    protected const CITIES = ['Dhanbad', 'Pune', 'Austin', 'Shanghai', 'Berlin', 'Lagos', 'Toronto', 'Madrid', 'Osaka', 'Denver', 'Lyon', 'Kolkata', 'Mumbai', 'Delhi', 'Bengaluru', 'Chennai', 'Nairobi', 'Lima', 'Oslo', 'Seoul'];
    protected const COUNTRIES = ['India', 'USA', 'China', 'Germany', 'Nigeria', 'Canada', 'Spain', 'Japan', 'France', 'Kenya', 'Peru', 'Norway', 'Korea', 'Brazil', 'Italy'];
    protected const COMPANIES = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Stark', 'Wayne', 'Hooli', 'Vandelay', 'Soylent', 'Wonka'];
    protected const SUFFIX = ['Inc', 'Ltd', 'LLC', 'Group', 'Labs', 'Systems'];
    protected const JOBS = ['Engineer', 'Designer', 'Teacher', 'Nurse', 'Accountant', 'Manager', 'Analyst', 'Developer', 'Technician', 'Consultant', 'Architect', 'Writer'];
    protected const STREETS = ['Main', 'Park', 'Oak', 'Maple', 'Cedar', 'Lake', 'Hill', 'River', 'Station', 'Market'];

    public function __construct(?int $seed = null) { mt_srand($seed ?? 42); }
    public function seed(int $s): void { mt_srand($s); }
    protected function pick(array $a) { return $a[mt_rand(0, count($a) - 1)]; }

    public function unique(bool $reset = false): UniqueProxy { return new UniqueProxy($this); }
    public function optional(float $weight = 0.5, $default = null): static { return $this; }
    public function name(): string { return $this->firstName() . ' ' . $this->lastName(); }
    public function firstName(): string { return $this->pick(self::FIRST); }
    public function lastName(): string { return $this->pick(self::LAST); }
    public function userName(): string { return strtolower($this->firstName() . '.' . $this->lastName() . mt_rand(1, 99)); }
    public function email(): string { return strtolower($this->firstName() . '.' . $this->lastName()) . mt_rand(1, 999) . '@' . $this->pick(['example.com', 'example.org', 'example.net']); }
    public function safeEmail(): string { return strtolower($this->firstName() . '.' . $this->lastName()) . mt_rand(1, 999) . '@example.com'; }
    public function freeEmail(): string { return $this->safeEmail(); }
    public function word(): string { return $this->pick(self::WORDS); }
    public function words(int $n = 3, bool $asText = false) { $w = []; for ($i = 0; $i < $n; $i++) $w[] = $this->word(); return $asText ? implode(' ', $w) : $w; }
    public function sentence(int $n = 6, bool $variable = true): string { $s = ucfirst($this->words($n, true)); return $s . '.'; }
    public function sentences(int $n = 3, bool $asText = false) { $s = []; for ($i = 0; $i < $n; $i++) $s[] = $this->sentence(); return $asText ? implode(' ', $s) : $s; }
    public function paragraph(int $n = 3): string { return $this->sentences($n, true); }
    public function paragraphs(int $n = 3, bool $asText = false) { $p = []; for ($i = 0; $i < $n; $i++) $p[] = $this->paragraph(); return $asText ? implode("\n\n", $p) : $p; }
    public function text(int $max = 200): string { $t = ''; while (strlen($t) < $max - 40) $t .= ' ' . $this->sentence(); return trim(substr(trim($t), 0, $max)); }
    public function slug(int $words = 3): string { return implode('-', $this->words($words)); }
    public function title(): string { return ucwords($this->words(mt_rand(2, 4), true)); }
    public function numberBetween(int $min = 0, int $max = 2147483647): int { return mt_rand($min, $max); }
    public function randomNumber(?int $digits = null): int { return mt_rand(0, 10 ** ($digits ?? 4) - 1); }
    public function randomDigit(): int { return mt_rand(0, 9); }
    public function randomDigitNotNull(): int { return mt_rand(1, 9); }
    public function randomFloat(?int $decimals = 2, float $min = 0, float $max = 100): float { return round($min + mt_rand() / mt_getrandmax() * ($max - $min), $decimals ?? 2); }
    public function boolean(int $chance = 50): bool { return mt_rand(1, 100) <= $chance; }
    public function randomElement(array $a = ['a', 'b', 'c']) { return $a ? $this->pick(array_values($a)) : null; }
    public function randomElements(array $a, int $count = 1): array { $a = array_values($a); shuffle($a); return array_slice($a, 0, $count); }
    public function shuffle($a) { if (is_string($a)) return str_shuffle($a); shuffle($a); return $a; }
    public function numerify(string $s = '###'): string { return preg_replace_callback('/#/', fn () => (string) mt_rand(0, 9), $s); }
    public function lexify(string $s = '????'): string { return preg_replace_callback('/\?/', fn () => chr(mt_rand(97, 122)), $s); }
    public function bothify(string $s = '## ??'): string { return $this->lexify($this->numerify($s)); }
    public function city(): string { return $this->pick(self::CITIES); }
    public function country(): string { return $this->pick(self::COUNTRIES); }
    public function streetAddress(): string { return mt_rand(1, 999) . ' ' . $this->pick(self::STREETS) . ' Street'; }
    public function address(): string { return $this->streetAddress() . ', ' . $this->city() . ', ' . $this->country(); }
    public function postcode(): string { return $this->numerify('######'); }
    public function phoneNumber(): string { return $this->numerify('+91 ##### #####'); }
    public function company(): string { return $this->pick(self::COMPANIES) . ' ' . $this->pick(self::SUFFIX); }
    public function jobTitle(): string { return $this->pick(self::JOBS); }
    public function url(): string { return 'https://www.' . $this->word() . '.example.com/' . $this->slug(2); }
    public function domainName(): string { return $this->word() . '.example.com'; }
    public function ipv4(): string { return mt_rand(1, 254) . '.' . mt_rand(0, 255) . '.' . mt_rand(0, 255) . '.' . mt_rand(1, 254); }
    public function password(int $min = 8, int $max = 20): string { return \Illuminate\Support\Str::random($min); }
    public function uuid(): string { return \Illuminate\Support\Str::uuid(); }
    public function hexColor(): string { return sprintf('#%06x', mt_rand(0, 0xFFFFFF)); }
    public function colorName(): string { return $this->pick(['red', 'green', 'blue', 'yellow', 'orange', 'purple', 'black', 'white']); }
    public function currencyCode(): string { return $this->pick(['USD', 'EUR', 'INR', 'JPY', 'GBP']); }
    public function imageUrl(int $w = 640, int $h = 480): string { return "https://picsum.photos/{$w}/{$h}"; }
    public function date(string $format = 'Y-m-d', $max = 'now'): string { return date($format, mt_rand(0, strtotime($max) ?: time())); }
    public function dateTime($max = 'now'): \DateTime { return new \Illuminate\Support\Carbon('@' . mt_rand(0, strtotime($max) ?: time())); }
    public function dateTimeBetween($start = '-30 years', $end = 'now'): \DateTime { return new \Illuminate\Support\Carbon('@' . mt_rand(strtotime($start), strtotime($end))); }
    public function dateTimeThisYear($max = 'now'): \DateTime { return $this->dateTimeBetween('first day of January this year', $max); }
    public function year($max = 'now'): string { return date('Y', mt_rand(0, strtotime($max))); }
    public function __get($k) { return method_exists($this, $k) ? $this->$k() : null; }
}

class UniqueProxy
{
    protected static array $seen = [];
    public function __construct(protected Generator $g) {}
    public function __call($m, $a)
    {
        for ($i = 0; $i < 1000; $i++) {
            $v = $this->g->$m(...$a);
            $key = $m . '|' . (is_scalar($v) ? $v : serialize($v));
            if (!isset(self::$seen[$key])) { self::$seen[$key] = true; return $v; }
        }
        throw new \OverflowException('Maximum retries of 1000 reached without finding a unique value');
    }
}

}
