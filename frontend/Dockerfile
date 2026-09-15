# syntax=docker/dockerfile:1

# --- Stage 1: build the static assets ---------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# VITE_API_URL is intentionally left unset here: in the bundled
# docker-compose setup the frontend and API share an origin through the
# nginx proxy below, so the app defaults to the relative path `/api`
# (see src/api/axios.js) and no build-time value is needed.
RUN npm run build

# --- Stage 2: serve with nginx -----------------------------------------
FROM nginx:1.27-alpine

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# nginx:alpine already runs its worker processes as the unprivileged
# `nginx` user by default; only master needs root to bind port 80.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/index.html > /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
