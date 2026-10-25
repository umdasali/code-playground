<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// Served at /api/hello. Try it from the request panel, or from the HTML/CSS/JS tab: fetch("/api/hello")
Route::get('/hello', function () {
    return ['message' => 'Hello from Laravel', 'time' => now()->toDateTimeString()];
});

Route::post('/echo', function (Request $request) {
    $data = $request->validate(['name' => 'required|string|min:2']);

    return response()->json(['greeting' => "Hello, {$data['name']}!"], 201);
});
