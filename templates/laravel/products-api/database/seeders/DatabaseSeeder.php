<?php

namespace Database\Seeders;

use App\Models\Product;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        Product::factory()->count(25)->create();

        Product::create(['name' => 'Laptop', 'sku' => 'LAP-001', 'price' => 899.99, 'stock' => 7, 'description' => 'A fast laptop', 'active' => true]);
    }
}
