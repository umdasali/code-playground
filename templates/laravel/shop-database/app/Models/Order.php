<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    public $timestamps = false;

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }

    public function items()
    {
        return $this->hasMany(OrderItem::class);
    }

    // $order->total  (an accessor: computed from the loaded items)
    public function getTotalAttribute(): float
    {
        return round($this->items->sum(fn ($i) => $i->qty * $i->unit_price), 2);
    }
}
