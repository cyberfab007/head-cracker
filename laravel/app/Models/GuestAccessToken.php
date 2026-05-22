<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Hash;

class GuestAccessToken extends Model
{
    protected $fillable = [
        'label',
        'token_hash',
        'active',
        'max_runs',
        'runs_used',
        'rate_limit_per_hour',
        'expires_at',
    ];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
            'expires_at' => 'datetime',
        ];
    }

    public function accepts(string $token): bool
    {
        if (! $this->active) {
            return false;
        }

        if ($this->expires_at && $this->expires_at->isPast()) {
            return false;
        }

        if ($this->runs_used >= $this->max_runs) {
            return false;
        }

        return $this->matchesToken($token);
    }

    public function matchesToken(string $token): bool
    {
        return Hash::check($token, $this->token_hash);
    }
}
