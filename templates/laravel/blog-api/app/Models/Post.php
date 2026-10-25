<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Post extends Model
{
    use HasFactory;

    protected $fillable = ['title', 'slug', 'body', 'published', 'published_at'];

    protected $casts = [
        'published' => 'boolean',
        'published_at' => 'datetime',
    ];

    // Route model binding uses the slug: /api/posts/hello-laravel
    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    public function comments()
    {
        return $this->hasMany(Comment::class);
    }

    public function tags()
    {
        return $this->belongsToMany(Tag::class);
    }

    public function scopePublished($query)
    {
        return $query->where('published', true);
    }
}
