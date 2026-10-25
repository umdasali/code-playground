<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    use HasFactory;

    // Only these columns can be filled with Product::create([...]) / $product->update([...]).
    protected $fillable = ['name', 'sku', 'price', 'stock', 'description', 'active'];

    protected $casts = [
        'price' => 'decimal:2',
        'stock' => 'integer',
        'active' => 'boolean',
    ];

    // Product::active()->get()
    public function scopeActive($query)
    {
        return $query->where('active', true);
    }
}
