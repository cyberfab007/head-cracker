<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AnalysisRun;
use App\Models\GuestAccessToken;
use Illuminate\Cache\RateLimiter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AnalysisRunController extends Controller
{
    public function store(Request $request, RateLimiter $limiter): JsonResponse
    {
        $data = $request->validate([
            'guest_id' => ['required', 'string', 'max:200'],
            'prompt' => ['required', 'string', 'min:3', 'max:2000'],
            'model_id' => ['nullable', 'string', 'max:120'],
            'driver' => ['nullable', 'string', 'max:80'],
            'max_new_tokens' => ['nullable', 'integer', 'min:1', 'max:96'],
            'layers' => ['nullable', 'array', 'max:24'],
            'layers.*' => ['integer', 'min:0', 'max:95'],
        ]);

        $guest = GuestAccessToken::query()
            ->get()
            ->first(fn (GuestAccessToken $candidate): bool => $candidate->accepts($data['guest_id']));

        if (! $guest) {
            return response()->json(['message' => 'Guest ID is invalid, expired, or exhausted.'], 403);
        }

        $rateKey = 'guest-run:'.$guest->id.':'.$request->ip();
        if ($limiter->tooManyAttempts($rateKey, $guest->rate_limit_per_hour)) {
            return response()->json([
                'message' => 'Rate limit reached for this guest ID.',
                'retry_after' => $limiter->availableIn($rateKey),
            ], 429);
        }

        $run = DB::transaction(function () use ($guest, $data, $limiter, $rateKey): AnalysisRun {
            $guest->increment('runs_used');
            $limiter->hit($rateKey, 3600);

            return AnalysisRun::query()->create([
                'guest_access_token_id' => $guest->id,
                'prompt' => $data['prompt'],
                'model_id' => $data['model_id'] ?? 'gpt2',
                'driver' => $data['driver'] ?? 'tl_gpt',
                'max_new_tokens' => $data['max_new_tokens'] ?? 32,
                'layers' => $data['layers'] ?? [0, 3, 6, 9],
                'status' => 'authorized',
            ]);
        });

        return response()->json([
            'run' => [
                'id' => $run->id,
                'status' => $run->status,
                'remaining_runs' => max(0, $guest->max_runs - $guest->fresh()->runs_used),
            ],
            'engine' => [
                'ws_url' => rtrim(config('services.headcracker.engine_ws_public'), '/').'/ws/generate',
            ],
            'config' => [
                'model_id' => $run->model_id,
                'driver' => $run->driver,
                'prompt' => $run->prompt,
                'max_new_tokens' => $run->max_new_tokens,
                'topk' => 5,
                'select_layers' => $run->layers,
                'pixels' => true,
                'pixel_layers' => $run->layers,
            ],
        ], 201);
    }

    public function update(Request $request, AnalysisRun $analysisRun): JsonResponse
    {
        $data = $request->validate([
            'guest_id' => ['required', 'string', 'max:200'],
            'status' => ['nullable', 'string', 'in:authorized,streaming,complete,error'],
            'frames_captured' => ['nullable', 'integer', 'min:0'],
            'summary' => ['nullable', 'array'],
        ]);

        if (! $analysisRun->guestAccessToken?->matchesToken($data['guest_id'])) {
            return response()->json(['message' => 'Guest ID cannot update this run.'], 403);
        }

        unset($data['guest_id']);
        $analysisRun->fill($data)->save();

        return response()->json(['run' => $analysisRun]);
    }
}
