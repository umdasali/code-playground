<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

class ProductFactory extends Factory
{
    public function definition(): array
    {
        return [
            'name' => ucfirst($this->faker->words(2, true)),
            'sku' => strtoupper($this->faker->unique()->bothify('??-####')),
            'price' => $this->faker->randomFloat(2, 5, 500),
            'stock' => $this->faker->numberBetween(0, 100),
            'description' => $this->faker->sentence(),
            'active' => $this->faker->boolean(85),
        ];
    }
}
