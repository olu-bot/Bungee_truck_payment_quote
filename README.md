# Bungee Connect

Full-stack freight quoting app (React + Vite + Express) with an optional **Shipbungee** layout: marketing site at `/` and Connect at `/connect/`, deployed to **Google Cloud Run**.

---

## Requirements

- **Node.js 20** and npm  
- **Google Cloud SDK** (`gcloud`) authenticated to your GCP project  
- **Artifact Registry** repository for container images (this project uses `bungee-connect-repo` in `us-central1`)  
- **`.env`** in the repo root for local dev and for sourcing build-time Vite values when deploying (copy from `.env.example`). Never commit `.env` or service account JSON.

---

## Local development

```bash
npm ci
cp .env.example .env   # fill in keys
npm run dev
```

Open **http://localhost:5000/** — Connect runs with Vite middleware (hot reload). The marketing site under `website/shipbungee_website/` is not wired into `npm run dev`; to preview **marketing + Connect** like production:

```bash
npm run build:shipbungee
SERVE_UNIFIED_SITE=1 CONNECT_PUBLIC_PATH=connect PUBLIC_APP_URL=http://localhost:5000 npm start
```

Then **/** = marketing, **/connect/** = Connect.

---

## Production deployment (GCP)

Images are built with **Cloud Build** from `Dockerfile` (Vite client + bundled server). Runtime secrets (Stripe, Firebase Admin, SMTP) are **Cloud Run environment variables**, not bake-time args.

### 1. Shipbungee (recommended): `shipbungee.com` + `shipbungee.com/connect/`

Use **`cloudbuild.shipbungee.yaml`**. It sets `VITE_BASE_PATH=/connect/` and `VITE_CONNECT_GUEST_MODE=true` for the guest + sign-in flow.

**Build and push** (run from this repo root, where `Dockerfile` lives):

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"
export REPO="bungee-connect-repo"
export TAG="prod-shipbungee-$(date +%Y%m%d-%H%M%S)"
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/bungee-connect:${TAG}"

gcloud builds submit \
  --config=cloudbuild.shipbungee.yaml \
  --substitutions=_IMAGE_URI="${IMAGE}",_VITE_GOOGLE_MAPS_API_KEY="$(grep -E '^VITE_GOOGLE_MAPS_API_KEY=' .env | cut -d= -f2-)",_VITE_FIREBASE_API_KEY="$(grep -E '^VITE_FIREBASE_API_KEY=' .env | cut -d= -f2-)",_VITE_FIREBASE_AUTH_DOMAIN="$(grep -E '^VITE_FIREBASE_AUTH_DOMAIN=' .env | cut -d= -f2-)",_VITE_FIREBASE_PROJECT_ID="$(grep -E '^VITE_FIREBASE_PROJECT_ID=' .env | cut -d= -f2-)",_VITE_FIREBASE_STORAGE_BUCKET="$(grep -E '^VITE_FIREBASE_STORAGE_BUCKET=' .env | cut -d= -f2-)",_VITE_FIREBASE_MESSAGING_SENDER_ID="$(grep -E '^VITE_FIREBASE_MESSAGING_SENDER_ID=' .env | cut -d= -f2-)",_VITE_FIREBASE_APP_ID="$(grep -E '^VITE_FIREBASE_APP_ID=' .env | cut -d= -f2-)",_VITE_FIREBASE_MEASUREMENT_ID="$(grep -E '^VITE_FIREBASE_MEASUREMENT_ID=' .env | cut -d= -f2-)" \
  .
```

If any value contains a **comma**, Cloud Build requires escaping it as `\,` inside substitutions; a small script that reads `.env` and calls `gcloud` (without printing secrets) is often easier.

**Deploy** the new image to your unified Cloud Run service (example service name `shipbungee-site`):

```bash
gcloud run deploy shipbungee-site \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --quiet
```

**Required runtime env** on that service (set in Cloud Run console or `gcloud run services update`):

| Variable | Example / notes |
|----------|------------------|
| `SERVE_UNIFIED_SITE` | `true` |
| `PUBLIC_APP_URL` | `https://shipbungee.com` (no trailing slash) |
| `CONNECT_PUBLIC_PATH` | `connect` |
| `STRIPE_SECRET_KEY` | From Stripe Dashboard |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for your webhook endpoint |
| `STRIPE_PRICE_ID_*` | As in `.env.example` |
| `GOOGLE_MAPS_API_KEY` | Optional; Places on server if used |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Minified JSON **or** use a Cloud Run service account with Firebase access |
| `VITE_*` | **Not** needed at runtime for the already-built client; only at **image build** time |

**Stripe:** Webhook URL should be **`https://shipbungee.com/api/stripe/webhook`**. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.

**Firebase:** Add **`shipbungee.com`** (and `www` if used) under Authentication → Settings → **Authorized domains**. Restrict **Google Maps** keys with HTTP referrers for those origins if the key is referrer-locked.

**Employee Tools** (`https://shipbungee.com/calculator.html`): The employee password is **not** in the client. Create a Firestore document **`admin_only_config`** / **`employee_calculator`** with field **`password`** (string). The Cloud Run service reads it with Firebase Admin. Deploy **`firestore.rules`** so `admin_only_config` stays server-only. For local dev without that doc, set **`SHIPBUNGEE_EMPLOYEE_CALCULATOR_PASSWORD`** in `.env`.

---

### 2. Standalone Connect only (app at `/`)

Use **`cloudbuild.yaml`** (default `VITE_BASE_PATH=/`, no guest mode in the yaml file itself).

```bash
export TAG="prod-standalone-$(date +%Y%m%d-%H%M%S)"
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/bungee-connect:${TAG}"

gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_IMAGE_URI="${IMAGE}",_VITE_GOOGLE_MAPS_API_KEY="...",_VITE_FIREBASE_API_KEY="...",_VITE_FIREBASE_AUTH_DOMAIN="...",_VITE_FIREBASE_PROJECT_ID="...",_VITE_FIREBASE_STORAGE_BUCKET="...",_VITE_FIREBASE_MESSAGING_SENDER_ID="...",_VITE_FIREBASE_APP_ID="...",_VITE_FIREBASE_MEASUREMENT_ID="..." \
  .
```

Deploy to your standalone service (e.g. `bungee-connect`):

```bash
gcloud run deploy bungee-connect \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --quiet
```

Set **`PUBLIC_APP_URL`** to the public URL of **that** service (no trailing slash). Leave **`CONNECT_PUBLIC_PATH`** and **`SERVE_UNIFIED_SITE`** unset / false.

---

## Scripts reference

| Script | Purpose |
|--------|--------|
| `npm run dev` | Local API + Vite (Connect at `/`) |
| `npm run build` | Production build, `VITE_BASE_PATH=/` |
| `npm run build:shipbungee` | Production build for `/connect/` |
| `npm start` | Run compiled server (`dist/`) — use after `npm run build` |
| `npm run check` | Typecheck (`tsc --noEmit`) |

---

## Repository layout

- **`client/`** — Connect SPA  
- **`server/`** — Express API and static serving  
- **`website/shipbungee_website/`** — Marketing HTML (served when `SERVE_UNIFIED_SITE=true`)  
- **`cloudbuild.yaml`** — Image for Connect-at-root  
- **`cloudbuild.shipbungee.yaml`** — Image for Shipbungee unified site  

See **`.env.example`** for all configuration keys and comments.
