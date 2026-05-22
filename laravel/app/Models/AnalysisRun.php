<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AnalysisRun extends Model
{
    protected $fillable = [
        'guest_access_token_id',
        'prompt',
        'model_id',
        'driver',
        'max_new_tokens',
        'layers',
        'status',
        'frames_captured',
        'summary',
    ];

    protected function casts(): array
    {
        return [
            'layers' => 'array',
            'summary' => 'array',
        ];
    }

    public function guestAccessToken(): BelongsTo
    {
        return $this->belongsTo(GuestAccessToken::class);
    }
}
