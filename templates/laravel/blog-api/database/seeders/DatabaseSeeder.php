<?php

namespace Database\Seeders;

use App\Models\Comment;
use App\Models\Post;
use App\Models\Tag;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $tags = collect(['laravel', 'php', 'sql', 'api'])->map(fn ($name) => Tag::create(['name' => $name]));

        // a post with a fixed slug, so the sample requests always work
        $hello = Post::create([
            'title' => 'Hello Laravel',
            'slug' => 'hello-laravel',
            'body' => 'This API runs real PHP in your browser. Every query it makes shows up in the Queries tab.',
            'published' => true,
            'published_at' => now(),
        ]);
        $hello->tags()->attach($tags->pluck('id')->take(2));
        Comment::factory()->count(3)->make()->each(fn ($c) => $hello->comments()->create($c->only(['author', 'body'])));

        Post::factory()->count(9)->create()->each(function (Post $post) use ($tags) {
            $post->tags()->attach($tags->random(2)->pluck('id'));
            foreach (range(1, mt_rand(0, 3)) as $_) {
                $post->comments()->create(Comment::factory()->make()->only(['author', 'body']));
            }
        });
    }
}
