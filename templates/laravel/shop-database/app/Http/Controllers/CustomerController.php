<?php

namespace App\Http\Controllers;

use App\Models\Customer;
use Illuminate\Http\Request;

class CustomerController extends Controller
{
    public function show(Customer $customer)
    {
        return $customer->load('orders');
    }

    // Writes to the shop database: afterwards run  SELECT * FROM customers ORDER BY id DESC LIMIT 3;  in the MariaDB tab.
    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:60'],
            'email' => ['required', 'email', 'unique:customers,email'],
            'city' => ['nullable', 'string'],
            'country' => ['nullable', 'string'],
        ]);

        $customer = Customer::create($data + ['joined' => now()->toDateString()]);

        return response()->json($customer, 201);
    }
}
