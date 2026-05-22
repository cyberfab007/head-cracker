#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  cp .env.example .env
fi

if [ ! -f database/database.sqlite ]; then
  touch database/database.sqlite
fi

php artisan key:generate --force --no-interaction >/dev/null 2>&1 || true
php artisan migrate --force --no-interaction
php artisan db:seed --force --no-interaction

exec "$@"
