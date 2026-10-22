#!/bin/bash
set -eo pipefail

DOMAIN="${PIMATRIX_DOMAIN:-${DOMAIN:-localhost}}"
EMAIL="${LETSENCRYPT_EMAIL:-${EMAIL:-admin@$DOMAIN}}"
TLS_PORT="${PIMATRIX_TLS_PORT:-8443}"
UPSTREAM="${UPSTREAM_HOST:-host.docker.internal:3000}"
STAGING="${CERTBOT_STAGING:-false}"
RESTRICT_CANVA="${RESTRICT_TO_CANVA:-true}"

echo "=================================================="
echo " Starting PiMatrix TLS Reverse Proxy"
echo " Domain:        ${DOMAIN}"
echo " Email:         ${EMAIL}"
echo " TLS Port:      ${TLS_PORT}"
echo " Upstream:      ${UPSTREAM}"
echo " Canva Only:    ${RESTRICT_CANVA}"
echo " Certbot Stage: ${STAGING}"
echo "=================================================="

# Ensure directories
mkdir -p /var/www/certbot
mkdir -p /etc/nginx/ssl
mkdir -p "/etc/letsencrypt/live/${DOMAIN}"

CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"

# Bootstrap self-signed certificate if Let's Encrypt cert does not exist yet
if [ ! -f "$CERT_PATH" ] || [ ! -f "$KEY_PATH" ]; then
    echo "Let's Encrypt certificates not found for ${DOMAIN}. Creating bootstrap self-signed certificate..."
    openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
        -keyout /etc/nginx/ssl/bootstrap.key \
        -out /etc/nginx/ssl/bootstrap.crt \
        -subj "/CN=${DOMAIN}/O=PiMatrix/OU=AV Production" >/dev/null 2>&1
    ACTIVE_CERT="/etc/nginx/ssl/bootstrap.crt"
    ACTIVE_KEY="/etc/nginx/ssl/bootstrap.key"
else
    echo "Using existing Let's Encrypt certificates from ${CERT_PATH}"
    ACTIVE_CERT="$CERT_PATH"
    ACTIVE_KEY="$KEY_PATH"
fi

render_nginx_conf() {
    local cert="$1"
    local key="$2"

    cat <<EOF > /etc/nginx/conf.d/pimatrix.conf
# HTTP server for ACME challenge & HTTP redirection
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host:${TLS_PORT}\$request_uri;
    }
}

# TLS server for external WAN access
server {
    listen ${TLS_PORT} ssl;
    http2 on;
    server_name ${DOMAIN};

    ssl_certificate ${cert};
    ssl_certificate_key ${key};

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Performance & buffers
    proxy_buffering off;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;

    # Canva presentation integration endpoints
    location /canva/ {
        proxy_pass http://${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /api/v1/pipgm/canva/ {
        proxy_pass http://${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

EOF

    if [ "$RESTRICT_CANVA" = "true" ]; then
        cat <<EOF >> /etc/nginx/conf.d/pimatrix.conf
    # Block general LAN UI and sensitive AV hardware routes from public WAN port
    location / {
        default_type text/plain;
        return 403 "Forbidden: External WAN access is restricted to Canva presentation integrations.\n";
    }
}
EOF
    else
        cat <<EOF >> /etc/nginx/conf.d/pimatrix.conf
    # Pass all routes over TLS with SSE / WebSocket support
    location / {
        proxy_pass http://${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
    fi
}

# Write initial Nginx configuration
render_nginx_conf "$ACTIVE_CERT" "$ACTIVE_KEY"

# Start Nginx in background
echo "Starting Nginx daemon..."
nginx

# Acquire Let's Encrypt certificate if domain is real and cert doesn't exist yet
if [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "127.0.0.1" ] && [ ! -f "$CERT_PATH" ]; then
    echo "Attempting to obtain Let's Encrypt certificate for ${DOMAIN} via HTTP-01 challenge..."
    STAGING_FLAG=""
    if [ "$STAGING" = "true" ]; then
        STAGING_FLAG="--staging"
    fi

    if certbot certonly --webroot -w /var/www/certbot \
        -d "$DOMAIN" \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        --non-interactive \
        $STAGING_FLAG; then
        echo "Successfully obtained Let's Encrypt certificate for ${DOMAIN}!"
        render_nginx_conf "$CERT_PATH" "$KEY_PATH"
        nginx -s reload
    else
        echo "Warning: Certbot certificate issuance failed. Continuing with self-signed certificate."
        echo "Ensure ports 80 and ${TLS_PORT} are forwarded on your router and pointing to this machine."
    fi
fi

# Background auto-renewal loop (runs every 12 hours)
(
    while true; do
        sleep 43200 # 12 hours
        echo "[$(date)] Checking for certificate renewal..."
        if certbot renew --webroot -w /var/www/certbot --quiet; then
            if [ -f "$CERT_PATH" ]; then
                render_nginx_conf "$CERT_PATH" "$KEY_PATH"
                nginx -s reload
            fi
        fi
    done
) &

# Keep container alive by waiting on Nginx process
echo "PiMatrix TLS Reverse Proxy is running on port ${TLS_PORT} (HTTP-01 challenge on port 80)."
exec nginx -g "daemon off;"
