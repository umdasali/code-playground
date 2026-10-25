<?php

namespace App\Http\Controllers;

use App\Http\Resources\PostResource;
use App\Models\Post;
use App\Models\Tag;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class PostController extends Controller
{
    // GET /api/posts?tag=laravel  (look at the Queries tab: with() and withCount() avoid one query per post)
    public function index(Request $request)
    {
        $posts = Post::published()
            ->with('tags')
            ->withCount('comments')
            ->when($request->query('tag'), fn ($q, $tag) => $q->whereHas('tags', fn ($t) => $t->where('name', $tag)))
            ->latest('published_at')
            ->paginate(5);

        return PostResource::collection($posts);
    }

    public function show(Post $post)
    {
        return new PostResource($post->load(['tags', 'comments']));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:120'],
            'body' => ['required', 'string'],
            'published' => ['boolean'],
            'tags' => ['array'],
            'tags.*' => ['string', 'max:30'],
        ]);

        $post = Post::create([
            'title' => $data['title'],
            'slug' => Str::slug($data['title']),
            'body' => $data['body'],
            'published' => $data['published'] ?? false,
            'published_at' => ($data['published'] ?? false) ? now() : null,
        ]);

        $post->tags()->sync(collect($data['tags'] ?? [])->map(fn ($name) => Tag::firstOrCreate(['name' => $name])->id)->all());

        return new PostResource($post->load('tags'));
    }

    public function update(Request $request, Post $post)
    {
        $post->update($request->validate([
            'title' => ['sometimes', 'string', 'max:120'],
            'body' => ['sometimes', 'string'],
            'published' => ['sometimes', 'boolean'],
        ]));

        return new PostResource($post->load('tags'));
    }

    public function destroy(Post $post)
    {
        $post->delete(); // the comments go too: the foreign key is ON DELETE CASCADE

        return response()->noContent();
    }
}
