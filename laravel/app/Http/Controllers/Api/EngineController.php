<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;

class EngineController extends Controller
{
    public function meta(): JsonResponse
    {
        $response = Http::timeout(60)->get(config('services.headcracker.engine_http').'/meta', [
            'model_id' => request('model_id', 'gpt2'),
            'driver_key' => request('driver_key', 'tl_gpt'),
        ]);

        return response()->json($response->json(), $response->status());
    }

    public function health(): JsonResponse
    {
        $response = Http::timeout(10)->get(config('services.headcracker.engine_http').'/health');

        return response()->json($response->json(), $response->status());
    }
}
