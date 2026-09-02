<?php

namespace Database\Seeders;

use App\Models\GuestAccessToken;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $token = trim((string) config('services.headcracker.default_guest_id'));

        if ($token === '') {
            return;
        }

        GuestAccessToken::query()->updateOrCreate(
            ['label' => 'Runtime demo guest'],
            [
                'token_hash' => Hash::make($token),
                'active' => true,
                'max_runs' => 25,
                'rate_limit_per_hour' => 6,
                'expires_at' => null,
            ],
        );
    }
}
