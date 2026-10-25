<?php

namespace App\Http\Controllers;

use App\Http\Resources\CommentResource;
use App\Models\Comment;
use App\Models\Post;
use Illuminate\Http\Request;

class CommentController extends Controller
{
    public function index(Post $post)
    {
        return CommentResource::collection($post->comments()->latest()->get());
    }

    public function store(Request $request, Post $post)
    {
        $comment = $post->comments()->create($request->validate([
            'author' => ['required', 'string', 'max:60'],
            'body' => ['required', 'string', 'max:500'],
        ]));

        return new CommentResource($comment);
    }

    public function destroy(Post $post, Comment $comment)
    {
        abort_if($comment->post_id !== $post->id, 404, 'That comment belongs to another post.');
        $comment->delete();

        return response()->noContent();
    }
}
