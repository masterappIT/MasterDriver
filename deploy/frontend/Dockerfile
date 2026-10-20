# One image definition for the two static apps (web and admin). The built files
# come in as the "static" build context (see build-image.sh); APP picks the
# nginx configuration.
# A fixed version: on the server (deploy/hostkvm) the API's upstream is found again by name
# (`server ... resolve`), which needs nginx 1.27.3 or later.
FROM nginx:1.27.5-alpine

ARG APP
COPY deploy/frontend/${APP}.conf /etc/nginx/templates/default.conf.template
COPY --from=static / /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1
