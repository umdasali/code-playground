<?php

use App\Http\Controllers\CatalogController;
use App\Http\Controllers\CustomerController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\ReportController;
use Illuminate\Support\Facades\Route;

Route::get('/categories', [CatalogController::class, 'categories']);
Route::get('/products', [CatalogController::class, 'products']);
Route::get('/products/{product}', [CatalogController::class, 'product']);

Route::get('/customers/{customer}', [CustomerController::class, 'show']);
Route::post('/customers', [CustomerController::class, 'store']);

Route::get('/orders', [OrderController::class, 'index']);
Route::get('/orders/{order}', [OrderController::class, 'show']);

Route::prefix('reports')->group(function () {
    Route::get('/revenue-by-category', [ReportController::class, 'revenueByCategory']);
    Route::get('/top-customers', [ReportController::class, 'topCustomers']);
    Route::get('/orders-per-month', [ReportController::class, 'ordersPerMonth']);
});
