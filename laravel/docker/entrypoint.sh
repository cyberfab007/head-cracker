#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  cp .env.example .env
fi

set_env() {
  local key="$1"

  if [ -z "${!key+x}" ]; then
    return
  fi

  local value="${!key}"

  if grep -q "^${key}=" .env; then
    sed -i "s#^${key}=.*#${key}=${value}#" .env
  else
    printf '%s=%s\n' "${key}" "${value}" >> .env
  fi
}

for key in \
  APP_NAME APP_ENV APP_DEBUG APP_URL LOG_CHANNEL LOG_LEVEL \
  DB_CONNECTION DB_DATABASE CACHE_STORE SESSION_DRIVER SESSION_ENCRYPT \
  SESSION_DOMAIN SESSION_SECURE_COOKIE QUEUE_CONNECTION \
  HEADCRACKER_ENGINE_HTTP HEADCRACKER_ENGINE_WS_PUBLIC HEADCRACKER_DEMO_GUEST_ID
do
  set_env "${key}"
done

if [ ! -f database/database.sqlite ]; then
  touch database/database.sqlite
fi

php artisan key:generate --force --no-interaction >/dev/null 2>&1 || true
php artisan migrate --force --no-interaction
php artisan db:seed --force --no-interaction

exec "$@"
