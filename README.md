# opencode-llm

> 33 free AI models on your EC2 instance, ready for OmniRoute. Zero API keys, zero cost.

Standalone OpenAI-compatible API server adapting [pi-freeflow](https://github.com/trefeon/pi-freeflow)'s free model catalog (OpenCode Zen, KiloCode, OVHcloud) for use with [OmniRoute](https://github.com/diegosouzapw/OmniRoute) on EC2.

---

## What you get

| Feature | Details |
| :--- | :--- |
| **33 free models** | 12 OpenCode Zen + 13 KiloCode Gateway + 8 OVHcloud AI Endpoints |
| **OpenAI-compatible API** | Standard `/v1/chat/completions`, `/v1/models`, `/v1/responses` |
| **OmniRoute integration** | Drop-in self-hosted provider via `OMNIROUTE_SELF_HOSTED_PROVIDERS` or Dashboard |
| **Zero API keys** | All upstreams are keyless free tiers |
| **EC2-ready** | systemd service, Docker, docker-compose — pick your deployment |
| **Token-gated** | Optional `FREEFLOW_API_TOKEN` for production use |
| **Context up to 1M** | Multiple models support 1M+ token context windows |
| **SSE streaming** | Full streaming support for all models |

### Models available

**OpenCode Zen (12):** cat-jam-free, mimo-v2.6-flash-free, nemotron-3-ultra-free, nemotron-3.5-lightning-free, nemotron-3.5-super-vl-free, big-pickle, space-bunny-free, longcat-2.5-preview-free, glm-5.3-flash-free, beam-free, exo-free, deepseek-v4.1-flash-free

**KiloCode Gateway (13):** dots-3-note-preview, nemotron-3-nano-omni, nemotron-3-ultra-550b, nemotron-3.5-lightning, nemotron-3-super, north-mini-code, laguna-s-2.1, laguna-xs-2.1, lfm-2.5, kilo-auto, openrouter, glyph-cluster, inkling-small

**OVHcloud AI Endpoints (8):** gpt-oss-120b, gpt-oss-20b, qwen3.5-397b, qwen3.5-9b, qwen3.6-27b, qwen3.8-27b, mistral-small-3.2, llama-3.3-70b

> **Note:** Cline models are excluded — they require per-user browser login and are not suitable for headless server deployment.

---

## Quick Start

### Prerequisites

- **Node.js ≥ 22.19.0** (uses `--experimental-strip-types`)
- **EC2 instance** with port 28280 open in Security Group

### Option A: Direct install on EC2

```bash
# Clone and deploy
git clone <your-repo-url> /opt/freeflow-omniroute
cd /opt/freeflow-omniroute
sudo ./deploy/setup-ec2.sh
```

### Option B: Manual install

```bash
git clone <your-repo-url> freeflow-omniroute
cd freeflow-omniroute
npm install
node --experimental-strip-types src/server.ts
```

### Option C: Docker

```bash
cd freeflow-omniroute
docker build -t freeflow-omniroute .
docker run -d \
  --name freeflow-omniroute \
  -p 28280:28280 \
  -e FREEFLOW_HOST=0.0.0.0 \
  freeflow-omniroute
```

### Option D: Docker Compose

```bash
cd freeflow-omniroute
docker compose up -d
```

### Verify

```bash
# Health check
curl http://localhost:28280/health

# List models
curl http://localhost:28280/v1/models | jq '.data | length'
# → 33

# Test a completion
curl http://localhost:28280/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4.1-flash-free",
    "messages": [{"role": "user", "content": "Say hello!"}],
    "stream": false
  }'
```

---

## OmniRoute Integration

### Method 1: Self-Hosted Provider (YAML env var)

Add to your OmniRoute `.env`:

```env
OMNIROUTE_SELF_HOSTED_PROVIDERS='
  providers:
    - id: freeflow
      kind: openai
      baseUrl: http://<EC2_PRIVATE_IP>:28280/v1
      model: deepseek-v4.1-flash-free
'
```

### Method 2: Self-Hosted Provider File

Create `/etc/omniroute/providers.yaml`:

```yaml
providers:
  - id: freeflow
    kind: openai
    baseUrl: http://<EC2_PRIVATE_IP>:28280/v1
    model: deepseek-v4.1-flash-free
```

Then in OmniRoute `.env`:

```env
OMNIROUTE_SELF_HOSTED_PROVIDERS_FILE=/etc/omniroute/providers.yaml
```

### Method 3: OmniRoute Dashboard

1. Open OmniRoute Dashboard → **Providers** → **Add Connection**
2. Select **OpenAI Compatible**
3. **Base URL:** `http://<EC2_IP>:28280/v1`
4. **API Key:** leave empty (or set your `FREEFLOW_API_TOKEN` if auth is enabled)
5. **Default Model:** `deepseek-v4.1-flash-free`
6. Save

### Method 4: Docker Compose (same stack)

Uncomment the `omniroute` service in `docker-compose.yml` to run both OmniRoute and freeflow in the same Docker network — they communicate internally via `http://freeflow:28280/v1`.

---

## Configuration

| Env Variable | Default | Description |
| :--- | :--- | :--- |
| `FREEFLOW_PORT` | `28280` | Server port |
| `FREEFLOW_HOST` | `0.0.0.0` | Bind address |
| `FREEFLOW_API_TOKEN` | *(empty)* | When set, all /v1/* requests require `Authorization: Bearer <token>` |
| `FREEFLOW_REQUIRE_AUTH` | `false` | Force auth even without a token (for testing) |
| `FREEFLOW_DEBUG` | `0` | Enable debug logging (`1` = on) |
| `FREEFLOW_DATA_DIR` | `~/.freeflow-omniroute` | Log and data directory |
| `FREEFLOW_RELAYS` | *(empty)* | Comma-separated relay URLs (for OpenCode rate-limit avoidance) |
| `FREEFLOW_RELAY_MODE` | `auto` | Relay mode: `auto`, `spread`, or `off` |

---

## API Reference

### `GET /health`

Health check endpoint. No authentication required.

```json
{
  "status": "ok",
  "version": "1.0.0",
  "models": 33,
  "upstreams": { "opencode": 12, "kilo": 13, "ovh": 8 },
  "timestamp": "2026-10-19T15:30:00.000Z"
}
```

### `GET /v1/models`

Lists all available models in OpenAI format.

### `POST /v1/chat/completions`

Standard OpenAI Chat Completions API. Supports streaming (`"stream": true`).

```json
{
  "model": "deepseek-v4.1-flash-free",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "stream": true
}
```

### `POST /v1/responses`

OpenAI Responses API (for hosts that use it).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Your EC2 Instance                      │
│                                                             │
│  ┌─────────────────┐       ┌────────────────────────────┐  │
│  │                 │       │   freeflow-omniroute        │  │
│  │   OmniRoute     │──────▶│   :28280                   │  │
│  │   :20129        │       │                            │  │
│  │                 │       │  ┌──────────────────────┐  │  │
│  └─────────────────┘       │  │  Upstream Router     │  │  │
│                            │  │                      │  │  │
│                            │  │  OpenCode Zen ───────┼──┼──┼──▶ opencode.ai
│                            │  │  KiloCode GW ────────┼──┼──┼──▶ api.kilo.ai
│                            │  │  OVH AI ─────────────┼──┼──┼──▶ oai.endpoints.kepler.ai.cloud.ovh.net
│                            │  │                      │  │  │
│                            │  └──────────────────────┘  │  │
│                            └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### How it works

1. **OmniRoute** receives a request from your AI coding agent (Claude Code, Codex, Cursor, etc.)
2. OmniRoute routes the request to freeflow-omniroute as a self-hosted OpenAI-compatible provider
3. freeflow-omniroute identifies the model and routes to the correct upstream:
   - **OpenCode Zen** models → `opencode.ai/inference/v1` (with fingerprint headers)
   - **KiloCode Gateway** models → `api.kilo.ai/api/gateway/chat/completions` (keyless)
   - **OVHcloud** models → `oai.endpoints.kepler.ai.cloud.ovh.net/v1` (keyless)
4. The upstream response streams back through freeflow → OmniRoute → your agent

### Differences from pi-freeflow

| Aspect | pi-freeflow | freeflow-omniroute |
| :--- | :--- | :--- |
| **Runtime** | Pi/OMP extension (requires host) | Standalone Node.js server |
| **Binding** | Loopback only (127.0.0.1) | 0.0.0.0 for EC2/network |
| **Auth** | Token file in `~/.pi/agent/` | Bearer token via env var |
| **Models** | 35 (includes 2 Cline) | 33 (excludes Cline — needs browser login) |
| **Daemon** | Shared daemon with lease management | Simple HTTP server |
| **Deploy** | `omp plugin install` / `pi install` | Docker / systemd / direct |
| **Integration** | Registers as Pi/OMP provider | OpenAI-compatible endpoint for OmniRoute |

---

## Security

### Production checklist

- [ ] Set `FREEFLOW_API_TOKEN` and `FREEFLOW_REQUIRE_AUTH=true`
- [ ] Restrict EC2 Security Group: port 28280 only from OmniRoute's IP
- [ ] Use a private subnet if OmniRoute is on the same VPC
- [ ] Consider an nginx/Caddy reverse proxy with TLS for public exposure
- [ ] Monitor with `journalctl -u freeflow-omniroute -f`

### nginx reverse proxy example

```nginx
server {
    listen 443 ssl;
    server_name freeflow.example.com;

    ssl_certificate /etc/letsencrypt/live/freeflow.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/freeflow.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:28280;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_buffering off;  # Important for SSE streaming
        proxy_cache off;
    }
}
```

---

## License

MIT
