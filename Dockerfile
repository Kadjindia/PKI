# Image de service de l'application (fichiers statiques Vite servis par nginx).
# Prérequis : construire l'application avant le build de l'image (npm ci && npm run build),
# avec les variables VITE_SUPABASE_* renseignées : elles sont figées dans dist/ au build.
ARG REGISTRY=docker-registry.alsdmz.lan
FROM ${REGISTRY}/nginx:1.21-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/

# 1. Modifier les permissions pour que l'utilisateur 'nginx' puisse lire et écrire
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    chown -R nginx:nginx /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

# 2. Rétrograder les privilèges vers l'utilisateur standard
USER nginx

# 3. Port 80 : Docker (>= 20.10) autorise les ports < 1024 sans root
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
