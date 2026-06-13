# Worker service container (stage-1-preflight §3: portable to any container host
# — Railway/Fly/Render first per "fast prototype worker first", Azure-portable
# later). Multi-stage: install deps, then run the poll loop with tsx.
#
# The worker shares the repo's worker-safe core (lib/contract.ts, lib/engine/*,
# lib/core/state/*, lib/db/*, lib/adapters/*) and must contain NO Next.js
# imports, so the whole repo is copied but only worker/ + lib/ are executed.

# --- deps stage: install with a clean, reproducible lockfile -----------------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# --- runtime stage -----------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# tsx runs the TypeScript entrypoint directly (no separate build artifact). It
# is a devDependency, so install it explicitly in the runtime image.
COPY --from=deps /app/node_modules ./node_modules
RUN npm install --no-save tsx@^4.19.0

# Copy the worker-safe source. app/ and components/ are intentionally excluded
# (Next.js code is never imported by the worker).
COPY package.json tsconfig.json ./
COPY worker ./worker
COPY lib ./lib

# Health/readiness probe port (PORT or WORKER_PORT; default 8080).
EXPOSE 8080

# Run the poll loop. Override PORT / WORKER_POLL_INTERVAL_MS via env.
CMD ["npx", "tsx", "worker/index.ts"]
