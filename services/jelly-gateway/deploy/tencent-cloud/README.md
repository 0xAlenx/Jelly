# Tencent Cloud JellyAI Gateway Deployment

This directory deploys only the JellyAI cloud gateway, PostgreSQL and an HTTPS
reverse proxy. It does not deploy or modify the customer-side Hermes Web UI.

The gateway image includes the logistics quotation Python worker. Its quote
task state is isolated by customer account and stored in the persistent
`logistics-quote-data` Docker volume.

The gateway container also binds to `127.0.0.1:8787` on the server. When the
server already has Nginx on ports `80` and `443`, start only `postgres` and
`gateway`, then adapt `nginx-gateway.jellyai.cloud.conf` instead of starting
the bundled Caddy container.

## Prerequisites

- A Tencent Cloud CVM with Docker Engine and the Docker Compose plugin.
- A domain name with an `A` record pointing to the CVM public IP.
- Tencent Cloud security-group inbound rules for TCP ports `22`, `80` and `443`.

## First deployment

Upload `services/jelly-gateway/` to the server, then run:

```bash
cd services/jelly-gateway/deploy/tencent-cloud
cp .env.example .env
chmod 600 .env
```

Replace every `replace-with-*` value in `.env`, then start the service:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 gateway caddy
```

Verify:

```bash
curl https://gateway.example.com/health
```

For an existing Nginx installation:

```bash
docker compose up -d --build postgres gateway
curl http://127.0.0.1:8787/health
```

After `gateway.jellyai.cloud` resolves to the server, obtain a certificate,
install `nginx-gateway.jellyai.cloud.conf` under `/etc/nginx/conf.d/`, run
`nginx -t`, and reload Nginx.

Open `https://gateway.example.com/admin` to configure providers, model routing,
customers, credits and license keys.

For the customer domain, create an `A` record for `app.jellyai.cloud`, issue its
certificate, and install `nginx-app.jellyai.cloud.conf`.

The current rollout serves the complete JellyAI / Hermes workspace. Upload the
built `dist/client/` directory to `/var/www/jellyai-app/` on the cloud server.
Nginx serves these static UI files directly for stable page loads.

Hermes APIs and Socket.IO requests are forwarded through a restricted SSH
reverse tunnel from a Hermes execution node. Nginx only connects to the
loopback tunnel address `127.0.0.1:18650`, so the execution node does not expose
its local port directly to the Internet.

Install the dedicated public key for the restricted tunnel account on the cloud
server, then load `scripts/cloud.jellyai.hermes-tunnel.plist` on the macOS
execution node. The plist keeps this tunnel active:

```text
127.0.0.1:18650 on cloud server -> 127.0.0.1:8650 on execution node
```

This temporary execution-node mode is intentionally single-tenant. Do not use
one local Hermes state directory for unrelated customers. Multi-customer
production use requires per-tenant execution nodes or tenant-scoped Hermes
state isolation.

## Customer-side connection

Set the customer-side Hermes Web UI environment:

```env
JELLY_MANAGED_MODE=1
JELLY_GATEWAY_URL=https://gateway.example.com
```

## Backup

Create a PostgreSQL backup:

```bash
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-jellyai}" "${POSTGRES_DB:-jellyai}" \
  > "jellyai-$(date +%F-%H%M%S).sql"
```
