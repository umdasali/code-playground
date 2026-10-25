<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Str;

class PostResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'slug' => $this->slug,
            'excerpt' => Str::limit($this->body, 80),
            'body' => $this->body,
            'published_at' => $this->published_at?->toDateString(),
            // these keys only appear when the relation was loaded with with() / load() / withCount()
            'tags' => $this->whenLoaded('tags', fn () => $this->tags->pluck('name')),
            'comments_count' => $this->whenCounted('comments'),
            'comments' => CommentResource::collection($this->whenLoaded('comments')),
        ];
    }
}
