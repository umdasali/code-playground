<?php

use App\Http\Controllers\CommentController;
use App\Http\Controllers\PostController;
use App\Models\Tag;
use Illuminate\Support\Facades\Route;

Route::apiResource('posts', PostController::class);

// Nested resource: /api/posts/{post}/comments and /api/posts/{post}/comments/{comment}
Route::apiResource('posts.comments', CommentController::class)->only(['index', 'store', 'destroy']);

Route::get('/tags', fn () => Tag::withCount('posts')->orderBy('name')->get());
