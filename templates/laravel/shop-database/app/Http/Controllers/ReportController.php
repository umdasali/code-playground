<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\DB;

class ReportController extends Controller
{
    // Query builder with joins and aggregates (no models needed).
    public function revenueByCategory()
    {
        return DB::table('order_items as oi')
            ->join('orders as o', 'o.id', '=', 'oi.order_id')
            ->join('products as p', 'p.id', '=', 'oi.product_id')
            ->join('categories as c', 'c.id', '=', 'p.category_id')
            ->where('o.status', '!=', 'cancelled')
            ->select('c.name as category', DB::raw('round(sum(oi.qty * oi.unit_price), 2) as revenue'))
            ->groupBy('c.id', 'c.name')
            ->orderByDesc('revenue')
            ->get();
    }

    public function topCustomers()
    {
        return DB::table('customers as c')
            ->join('orders as o', 'o.customer_id', '=', 'c.id')
            ->join('order_items as oi', 'oi.order_id', '=', 'o.id')
            ->select('c.id', 'c.name', DB::raw('count(distinct o.id) as orders'), DB::raw('round(sum(oi.qty * oi.unit_price), 2) as spent'))
            ->groupBy('c.id', 'c.name')
            ->orderByDesc('spent')
            ->limit(5)
            ->get();
    }

    // DATE_FORMAT works in raw expressions, as it does on MariaDB.
    public function ordersPerMonth()
    {
        return DB::table('orders')
            ->select(DB::raw("DATE_FORMAT(ordered_at, '%Y-%m') as month"), DB::raw('count(*) as orders'))
            ->groupBy('month')
            ->orderBy('month')
            ->get();
    }
}
