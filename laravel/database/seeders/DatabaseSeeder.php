<?php

namespace Database\Seeders;

use App\Models\GuestAccessToken;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $token = config('services.headcracker.default_guest_id');

        GuestAccessToken::query()->updateOrCreate(
            ['label' => 'Local demo guest'],
            [
                'token_hash' => Hash::make($token),
                'active' => true,
                'max_runs' => 25,
                'runs_used' => 0,
                'rate_limit_per_hour' => 6,
                'expires_at' => null,
            ],
        );
    }
}
