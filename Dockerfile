FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./
COPY public ./public
COPY server ./server

RUN node --check server/index.js \
    && node --check public/app.js

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=4173

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/server ./server

USER node

EXPOSE 4173

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/catalog').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
