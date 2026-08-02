# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-alpine

LABEL org.opencontainers.image.title="PumpFun All-Claims Feed Bot"
LABEL org.opencontainers.image.description="Telegram channel feed broadcasting every PumpFun fee claim, with instant posts for large claims and periodic digests for the rest"

WORKDIR /app

RUN addgroup -S bot && adduser -S bot -G bot

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist dist/

USER bot

EXPOSE 3000

CMD ["node", "--enable-source-maps", "--max-old-space-size=1536", "dist/index.js"]
