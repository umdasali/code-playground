<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    // Decides exactly which fields the API returns.
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'sku' => $this->sku,
            'price' => $this->price,
            'in_stock' => $this->stock > 0,
            'stock' => $this->stock,
            'description' => $this->description,
            'active' => $this->active,
            'created_at' => $this->created_at?->toDateTimeString(),
        ];
    }
}
