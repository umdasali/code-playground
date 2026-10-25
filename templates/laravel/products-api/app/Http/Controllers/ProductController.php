<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreProductRequest;
use App\Http\Requests\UpdateProductRequest;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    // GET /api/products?search=lap&in_stock=1&sort=price&per_page=5
    public function index(Request $request)
    {
        $products = Product::query()
            ->when($request->query('search'), fn ($q, $s) => $q->where('name', 'like', "%{$s}%"))
            ->when($request->boolean('in_stock'), fn ($q) => $q->where('stock', '>', 0))
            ->orderBy($request->query('sort', 'id'))
            ->paginate((int) $request->query('per_page', 10));

        return ProductResource::collection($products);
    }

    // POST /api/products  (validated by StoreProductRequest, answers 201 Created)
    public function store(StoreProductRequest $request)
    {
        $product = Product::create($request->validated());

        return new ProductResource($product);
    }

    // GET /api/products/5   ($product is found for you: route model binding, 404 if missing)
    public function show(Product $product)
    {
        return new ProductResource($product);
    }

    // PUT/PATCH /api/products/5
    public function update(UpdateProductRequest $request, Product $product)
    {
        $product->update($request->validated());

        return new ProductResource($product);
    }

    // DELETE /api/products/5
    public function destroy(Product $product)
    {
        $product->delete();

        return response()->noContent();
    }

    // GET /api/products/stats  (query builder aggregates)
    public function stats()
    {
        return [
            'count' => Product::count(),
            'in_stock' => Product::where('stock', '>', 0)->count(),
            'average_price' => round((float) Product::avg('price'), 2),
            'most_expensive' => Product::orderByDesc('price')->first()?->name,
        ];
    }
}
