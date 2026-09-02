# HeadCracker

HeadCracker is an open-source, local-first AI interpretability workbench for tracing model-internal activation patterns during generation. The default demo model is GPT-2 because it is small, fast, easy to run locally, and well supported by TransformerLens.

The project is designed for defensive guardrail research: studying attention patterns, MLP activations, residual stream changes, token probabilities, and layer correlations that may help harden Zyke.AI-style models against jailbreak behavior.

## Architecture

```text
Laravel app  -> public site, guest gate, dashboard, run records, display shell
Python engine -> FastAPI, TransformerLens, GPT-2, activation streaming
Browser UI   -> Arwes React console, live pixel map, token/layer telemetry
Unity later  -> can consume the same saved trace format
```

## Services

- Laravel UI: `http://localhost:8080`
- Engine API: `http://localhost:8000`
- Engine health: `http://localhost:8000/health`
- Engine metadata: `http://localhost:8000/meta?model_id=gpt2&driver_key=tl_gpt`
- Production domain target: `https://headcracker.jeremyfabiano.com`

## Run With Docker

Set a local guest ID in your shell, then start the stack:

```bash
export HEADCRACKER_DEMO_GUEST_ID="choose-a-local-only-guest-id"
docker compose up --build
```

Open `http://localhost:8080`.

The website includes:

- Home: public project overview and the gated live prompt console.
- Scientific Method: defensive interpretability workflow and research boundaries.
- GitHub: public install path and stack summary.

The guest ID is rate-limited and capped by Laravel. Prompt execution is gated through `POST /api/runs`; the frontend only opens the engine stream after Laravel authorizes the run.

## Project Layout

```text
engine/
  app/                 # FastAPI + TransformerLens engine
  Dockerfile
  requirements.txt

laravel/
  app/                 # Laravel models/controllers
  database/migrations  # guest IDs and analysis runs
  resources/js/app.jsx # Arwes React console
  resources/css/app.css
  Dockerfile

deploy/kubernetes/     # Fleet workload + shared BuildKit builder

docker-compose.yml
```

## Local Development

The host does not need PHP or Composer if you use Docker.

Frontend-only checks from `laravel/`:

```bash
npm install
npm run build
```

Laravel checks without host PHP:

```bash
docker run --rm -v "$PWD/laravel":/app -w /app composer:2 php artisan test
```

Python syntax check:

```bash
python3 -m py_compile engine/app/server.py engine/app/schemas.py engine/app/drivers/base.py engine/app/drivers/tl_gpt.py
```

Dependency security checks:

```bash
docker run --rm -v "$PWD/laravel":/app -w /app composer:2 composer audit --locked
docker run --rm -v "$PWD/laravel":/app -w /app node:24-alpine sh -lc "npm audit --omit=dev"
```

## Production Security Notes

Production secrets are not stored in this public repository. Fleet deploys the Kubernetes resources, and the in-cluster builder creates the `head-cracker-runtime` Secret on first run with a random Laravel `APP_KEY` and random guest ID. The values are consumed by the Laravel deployment and are not written to Git or build logs.

Keep `APP_DEBUG=false`, serve only over HTTPS, and keep local `.env` files outside source control. The Laravel app sets security headers, denies framing, uses a restrictive CSP for the public domain and local dev endpoints, enables HSTS on secure requests, and throttles prompt-run API routes. The engine WebSocket is reverse-proxied behind HTTPS/WSS in Kubernetes.

## Current Run Flow

1. Visitor enters an issued guest ID.
2. Laravel validates the ID, run quota, and hourly rate limit.
3. Laravel creates an `analysis_runs` record.
4. The browser receives the authorized engine WebSocket URL and run config.
5. The Python engine runs GPT-2 and streams token-by-token telemetry.
6. The Arwes console displays activation pixels, top-k token probabilities, layer telemetry, and generated text.

## Research Scope

HeadCracker does not claim to directly identify every “guardrail weight.” The accurate research target is to expose correlated activations, circuits, layer behaviors, and intervention points associated with safety-relevant model decisions.
