# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# - iputils: provides the `ping` binary used by the "ping" monitor type
# - libcap: lets us grant the ping binary CAP_NET_RAW without running as root
# - dumb-init: proper PID 1 signal handling (clean SIGTERM shutdown)
# - ca-certificates: up-to-date root CAs for outbound HTTPS/TLS checks
RUN apk add --no-cache iputils libcap ca-certificates dumb-init \
  && setcap cap_net_raw+ep "$(which ping)"

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Run as an unprivileged user. The ping binary itself carries the NET_RAW
# file capability set above, so unprivileged ICMP still works as long as
# the container is started with `cap_add: [NET_RAW]` (see docker-compose.yml).
# HTTP and TCP-port checks need no special capability at all.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
  && chown -R appuser:appgroup /app
USER appuser

ENV NODE_ENV=production
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:5000/api/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
