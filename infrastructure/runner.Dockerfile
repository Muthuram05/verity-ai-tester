ARG PLAYWRIGHT_BASE=mcr.microsoft.com/playwright:v1.64.0-noble
FROM ${PLAYWRIGHT_BASE}
WORKDIR /app
COPY .local/runner-deps /app/node_modules
COPY .local/browser.mjs /app/browser.mjs
USER pwuser
ENTRYPOINT ["node", "/app/browser.mjs"]
