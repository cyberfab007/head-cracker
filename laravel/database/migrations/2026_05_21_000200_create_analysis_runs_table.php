<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('analysis_runs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('guest_access_token_id')->nullable()->constrained()->nullOnDelete();
            $table->text('prompt');
            $table->string('model_id')->default('gpt2');
            $table->string('driver')->default('tl_gpt');
            $table->unsignedInteger('max_new_tokens')->default(32);
            $table->json('layers')->nullable();
            $table->string('status')->default('authorized');
            $table->unsignedInteger('frames_captured')->default(0);
            $table->json('summary')->nullable();
            $table->timestamps();

            $table->index(['status', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('analysis_runs');
    }
};
