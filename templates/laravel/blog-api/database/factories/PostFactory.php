<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

class PostFactory extends Factory
{
    public function definition(): array
    {
        $title = rtrim($this->faker->sentence(4), '.');
        $published = $this->faker->boolean(80);

        return [
            'title' => $title,
            'slug' => Str::slug($title) . '-' . $this->faker->numberBetween(100, 999),
            'body' => $this->faker->paragraph(3),
            'published' => $published,
            'published_at' => $published ? $this->faker->dateTimeBetween('-2 months') : null,
        ];
    }
}
