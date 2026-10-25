<?php

namespace App\Http\Controllers;

use App\Models\Category;
use App\Models\Product;
use Illuminate\Http\Request;

class CatalogController extends Controller
{
    public function categories()
    {
        return Category::withCount('products')->orderBy('name')->get();
    }

    // GET /api/products?category=Audio&min_price=50&max_price=300&sort=price
    public function products(Request $request)
    {
        return Product::with('category')
            ->when($request->query('category'), fn ($q, $name) => $q->whereHas('category', fn ($c) => $c->where('name', $name)))
            ->when($request->query('min_price'), fn ($q, $v) => $q->where('price', '>=', $v))
            ->when($request->query('max_price'), fn ($q, $v) => $q->where('price', '<=', $v))
            ->orderBy($request->query('sort', 'name'))
            ->get();
    }

    public function product(Product $product)
    {
        return $product->load('category');
    }
}
