<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Customer extends Model
{
    public $timestamps = false;

    // mass assignment is allowed for these columns
    protected $fillable = ['name', 'email', 'city', 'country', 'joined'];

    public function orders()
    {
        return $this->hasMany(Order::class);
    }
}
