FROM node:24-bookworm AS dependencies
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm_config_nodedir=/usr/local npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 DB_PATH=/data/data.db
WORKDIR /app/backend
RUN mkdir -p /data && chown node:node /data
COPY --from=dependencies --chown=node:node /app/backend/node_modules ./node_modules
COPY --chown=node:node backend/package.json backend/package-lock.json backend/server.js backend/contract.json ./
COPY --chown=node:node scripts/deployment-networks.js /app/scripts/deployment-networks.js
USER node
EXPOSE 4000
CMD ["node", "server.js"]
