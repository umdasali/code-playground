<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrderItem extends Model
{
    public $timestamps = false;
    public $incrementing = false;   // order_items has a composite primary key (order_id, product_id)
    protected $primaryKey = null;

    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}
