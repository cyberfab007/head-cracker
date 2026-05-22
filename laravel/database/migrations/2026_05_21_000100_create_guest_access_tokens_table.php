<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('guest_access_tokens', function (Blueprint $table): void {
            $table->id();
            $table->string('label');
            $table->string('token_hash');
            $table->boolean('active')->default(true);
            $table->unsignedInteger('max_runs')->default(10);
            $table->unsignedInteger('runs_used')->default(0);
            $table->unsignedInteger('rate_limit_per_hour')->default(5);
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('guest_access_tokens');
    }
};
