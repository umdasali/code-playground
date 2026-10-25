<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:100'],
            'sku' => ['required', 'string', 'max:20', 'unique:products,sku'],
            'price' => ['required', 'numeric', 'min:0'],
            'stock' => ['integer', 'min:0'],
            'description' => ['nullable', 'string'],
            'active' => ['boolean'],
        ];
    }
}
