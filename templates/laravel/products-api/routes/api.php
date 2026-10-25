<?php

use App\Http\Controllers\ProductController;
use Illuminate\Support\Facades\Route;

// Every route in this file is served under /api (routes/api.php is prefixed like in real Laravel).
Route::get('/ping', fn () => ['pong' => true, 'time' => now()->toDateTimeString()]);

Route::get('/products/stats', [ProductController::class, 'stats']);
Route::apiResource('products', ProductController::class);
