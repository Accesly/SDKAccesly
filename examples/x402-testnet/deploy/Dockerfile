# Servicio x402 de testnet (bóveda F2 + facilitador + agente de referencia).
# Contexto: el bundle de `pnpm --filter @accesly/example-x402-testnet deploy --prod <dir>`,
# que ya trae @accesly/core adentro de node_modules.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY . .
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data && chown app:app /data
USER app
ENV PORT=4021 DATA_DIR=/data
EXPOSE 4021
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:4021/health || exit 1
CMD ["node", "server/index.mjs"]
