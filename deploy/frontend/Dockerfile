# One image definition for the two static apps (web and admin). The built files
# come in as the "static" build context (see build-image.sh); APP picks the
# nginx configuration.
FROM nginx:1.27-alpine

ARG APP
COPY deploy/frontend/${APP}.conf /etc/nginx/templates/default.conf.template
COPY --from=static / /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1
