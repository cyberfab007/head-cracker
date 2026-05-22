<?php

use App\Http\Controllers\Api\AnalysisRunController;
use App\Http\Controllers\Api\EngineController;
use Illuminate\Support\Facades\Route;

Route::get('/engine/health', [EngineController::class, 'health']);
Route::get('/engine/meta', [EngineController::class, 'meta']);

Route::middleware('throttle:30,1')->group(function (): void {
    Route::post('/runs', [AnalysisRunController::class, 'store']);
    Route::patch('/runs/{analysisRun}', [AnalysisRunController::class, 'update']);
});
