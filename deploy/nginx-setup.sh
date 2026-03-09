#!/usr/bin/env bash

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
APP_NAME="$(basename "$REPO_ROOT")"

source "$DEPLOY_DIR/app-config.sh"

DOMAIN="${1:?usage: bash deploy/nginx-setup.sh <domain> [upstream_name]}"
UPSTREAM_NAME="${2:-$(echo "$DOMAIN" | tr . _ | tr - _)}"
HOST_PORT="$(get_host_port "$APP_NAME")"

NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
RATE_LIMIT_CONF="/etc/nginx/conf.d/rate-limiting.conf"

echo "[1] Installing rate-limiting config"
if [ ! -f "$RATE_LIMIT_CONF" ]; then
    cp "$DEPLOY_DIR/nginx-rate-limiting.conf" "$RATE_LIMIT_CONF"
    echo "    Installed $RATE_LIMIT_CONF"
else
    echo "    Already exists, skipping"
fi

echo "[2] Generating nginx site config for $DOMAIN"
sed \
    -e "s/__UPSTREAM_NAME__/$UPSTREAM_NAME/g" \
    -e "s/__SERVER_NAME__/$DOMAIN/g" \
    -e "s/__PORT__/$HOST_PORT/g" \
    "$DEPLOY_DIR/nginx.conf.template" > "$NGINX_CONF"
echo "    Written to $NGINX_CONF"

echo "[3] Enabling site"
ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN"

echo "[4] Testing nginx config"
nginx -t

echo "[5] Reloading nginx"
systemctl reload nginx

echo ""
echo "Done. Run certbot to add SSL:"
echo "  certbot --nginx -d $DOMAIN"
