FROM nginx:1.27-alpine

RUN apk add --no-cache certbot openssl bash curl

# Clean out default virtual host configurations
RUN rm -rf /etc/nginx/conf.d/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80 8443

ENTRYPOINT ["/entrypoint.sh"]
