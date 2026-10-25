<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Category extends Model
{
    public $timestamps = false; // the shop tables have no created_at / updated_at

    public function products()
    {
        return $this->hasMany(Product::class);
    }
}
