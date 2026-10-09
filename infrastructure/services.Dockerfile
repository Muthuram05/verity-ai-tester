ARG SERVICES_BASE=node:22-alpine3.24
FROM ${SERVICES_BASE}
WORKDIR /app
COPY apps/demo ./apps/demo
COPY infrastructure/proxy.mjs ./infrastructure/proxy.mjs
USER node
