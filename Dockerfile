# syntax=docker/dockerfile:1

##
## Cloud Run container for the full app:
## - Builds the React frontend (Vite)
## - Bundles the Express backend
## - Runs Express (which serves the built frontend from `dist/public`)
##

FROM node:20-slim AS builder
WORKDIR /app

# Install deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm install --no-fund --no-audit --prefer-offline

# Copy source
COPY . .

# Vite env vars are baked into the frontend at build time.
# Pass them as --build-arg when building the image.
ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=${VITE_GOOGLE_MAPS_API_KEY}

ARG VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY}

ARG VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN}

ARG VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID}

ARG VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_STORAGE_BUCKET=${VITE_FIREBASE_STORAGE_BUCKET}

ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID}

ARG VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID}

ARG VITE_FIREBASE_MEASUREMENT_ID
ENV VITE_FIREBASE_MEASUREMENT_ID=${VITE_FIREBASE_MEASUREMENT_ID}

# `/` for standalone Cloud Run; `/connect/` when unified with marketing (shipbungee.com/connect/).
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

# When `true`, shipbungee unified build opens the calculator without Firebase sign-in (guest + Quick Start profile).
ARG VITE_CONNECT_GUEST_MODE=
ENV VITE_CONNECT_GUEST_MODE=${VITE_CONNECT_GUEST_MODE}

# Build version — auto-generated as YYYY.MM.DD.HHmm if not passed explicitly.
# Baked into the frontend bundle AND written to dist/public/version.json so the
# running app can detect when a newer version has been deployed.
ARG VITE_APP_VERSION
RUN BUILD_VER="${VITE_APP_VERSION:-$(date +%Y.%m.%d.%H%M)}" && \
    printf "\nVITE_APP_VERSION=%s\n" "$BUILD_VER" >> .env && \
    echo "Build version: $BUILD_VER"

ENV NODE_ENV=production
RUN npm run build

# Write version.json into the static output so the client can poll it
RUN BUILD_VER=$(grep '^VITE_APP_VERSION=' .env | tail -1 | cut -d= -f2) && \
    printf '{"version":"%s"}\n' "$BUILD_VER" > dist/public/version.json


FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/website ./website

EXPOSE 5000
CMD ["npm", "start"]

