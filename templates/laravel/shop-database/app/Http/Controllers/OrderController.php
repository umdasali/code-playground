<?php

namespace App\Http\Controllers;

use App\Models\Order;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function index(Request $request)
    {
        return Order::with('customer:id,name')
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($request->query('customer_id'), fn ($q, $id) => $q->where('customer_id', $id))
            ->orderByDesc('ordered_at')
            ->paginate(10);
    }

    public function show(Order $order)
    {
        $order->load(['customer', 'items.product']);

        return array_merge($order->toArray(), ['total' => $order->total]);
    }
}
