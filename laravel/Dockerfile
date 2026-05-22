FROM node:24-alpine AS assets
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY resources ./resources
COPY vite.config.js ./
RUN npm run build

FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
COPY app ./app
COPY bootstrap ./bootstrap
COPY config ./config
COPY database ./database
COPY routes ./routes
COPY artisan ./
RUN composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader

FROM php:8.4-fpm-alpine
WORKDIR /var/www/html

RUN apk add --no-cache bash curl sqlite
RUN printf 'expose_php=Off\n' > /usr/local/etc/php/conf.d/security.ini

COPY --from=vendor /app/vendor ./vendor
COPY --from=assets /app/public/build ./public/build
COPY . .
COPY docker/entrypoint.sh /usr/local/bin/headcracker-entrypoint

RUN chmod +x /usr/local/bin/headcracker-entrypoint \
    && chown -R www-data:www-data storage bootstrap/cache database

EXPOSE 8000

ENTRYPOINT ["headcracker-entrypoint"]
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
