# Mailgun MCP Server

[![MCP](https://img.shields.io/badge/MCP-Server-blue.svg)](https://github.com/modelcontextprotocol)

## Overview

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for [Mailgun](https://mailgun.com), enabling MCP-compatible AI clients to interact with the Mailgun email service.

Supports two transport modes:
- **STDIO** — For local MCP clients (Claude Desktop, Cursor, Windsurf, etc.)
- **Streamable HTTP** — For self-hosted VPS deployment with Docker, Nginx, and analytics

### Capabilities

- **Messaging** — Send emails, retrieve stored messages, resend messages
- **Domains** — View domain details, verify DNS configuration, manage tracking settings (click, open, unsubscribe)
- **Webhooks** — List, create, update, and delete event webhooks
- **Routes** — View and update inbound email routing rules
- **Mailing Lists** — Create and manage mailing lists and their members
- **Templates** — Create and manage email templates with versioning
- **Analytics** — Query sending metrics, usage metrics, and logs
- **Stats** — View aggregate statistics by domain, tag, provider, device, and country
- **Suppressions** — View bounces, unsubscribes, complaints, and allowlist entries
- **IPs & IP Pools** — View IP assignments and dedicated IP pool configuration
- **Bounce Classification** — Analyze bounce types and delivery issues

## Prerequisites

- Node.js (v18 or higher)
- Mailgun account and API key
- Docker & Docker Compose (for VPS deployment)

---

## Quick Start (STDIO Mode)

### Configuration

Add the following to your MCP client configuration:

```json
{
  "mcpServers": {
    "mailgun": {
      "command": "npx",
      "args": ["-y", "mcp-mailgun"],
      "env": {
        "MAILGUN_API_KEY": "YOUR-mailgun-api-key",
        "MAILGUN_API_REGION": "us"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MAILGUN_API_KEY` | Yes | — | Your Mailgun API key |
| `MAILGUN_API_REGION` | No | `us` | API region: `us` or `eu` |

### Client-Specific Config Paths

- **Claude Desktop** (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop** (Windows): `%APPDATA%/Claude/claude_desktop_config.json`
- **Claude Code**: Run `claude mcp add` or edit `~/.claude.json`
- **Cursor**: Settings → MCP Servers
- **Windsurf**: Settings → MCP

---

## VPS Deployment (HTTP Mode)

### 1. Clone and Configure

```bash
# On your VPS
cd /opt/mcp-servers
git clone https://github.com/hithereiamaliff/mcp-mailgun.git mailgun
cd mailgun
cp .env.example .env
# Edit .env with your Mailgun API key
```

### 2. Firebase Analytics (Optional)

Place your Firebase service account JSON at `.credentials/firebase-service-account.json` for cloud-based analytics persistence.

### 3. Deploy with Docker

```bash
docker compose up -d --build
```

The server will be available at `http://localhost:8087`.

### 4. Nginx Reverse Proxy

Add the location block from `deploy/nginx-mcp.conf` to your Nginx server block:

```nginx
location /mailgun/ {
    proxy_pass http://127.0.0.1:8087/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_buffering off;
    proxy_cache off;
    client_max_body_size 10M;
}
```

Then reload Nginx: `sudo nginx -t && sudo systemctl reload nginx`

### 5. Auto-Deployment

GitHub Actions workflow (`.github/workflows/deploy-vps.yml`) auto-deploys on push to `main`. Configure these GitHub Secrets:

| Secret | Description |
|---|---|
| `VPS_HOST` | VPS hostname or IP |
| `VPS_USERNAME` | SSH username |
| `VPS_SSH_KEY` | SSH private key |
| `VPS_PORT` | SSH port (usually `22`) |

### HTTP Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Server info |
| `GET /health` | Health check |
| `POST /mcp` | MCP protocol endpoint |
| `GET /analytics` | Analytics JSON |
| `GET /analytics/dashboard` | Visual analytics dashboard |
| `GET /analytics/tools` | Tool usage stats |

### MCP Client Configuration (HTTP)

```json
{
  "mcpServers": {
    "mailgun": {
      "url": "https://mcp.yourdomain.com/mailgun/mcp?apiKey=YOUR_API_KEY&region=us"
    }
  }
}
```

---

## Sample Prompts

#### Send an Email
```
Can you send an email to EMAIL_HERE with a funny email body that makes it sound
like it's from the IT Desk from Office Space? Please use the sending domain
DOMAIN_HERE, and make the email from "postmaster@DOMAIN_HERE"!
```

#### Fetch and Visualize Sending Statistics
```
Would you be able to make a chart with email delivery statistics for the past week?
```

#### Manage Templates
```
Create a welcome email template for new signups on my domain DOMAIN_HERE.
Include a personalized greeting and a call-to-action button.
```

#### Investigate Deliverability
```
Can you check the bounce classification stats for my account and tell me
what the most common bounce reasons are?
```

#### Troubleshoot DNS
```
Check the DNS verification status for my domain DOMAIN_HERE and tell me
if anything needs fixing.
```

---

## Development

```bash
git clone https://github.com/hithereiamaliff/mcp-mailgun.git
cd mcp-mailgun
npm install
```

### Scripts

| Script | Description |
|---|---|
| `npm run build:tsc` | Build TypeScript to `dist/` |
| `npm start` | Run STDIO server (compiled) |
| `npm run start:http` | Run HTTP server (compiled) |
| `npm run dev:http` | Run HTTP server with tsx (dev) |
| `npm test` | Run tests |
| `npm run lint` | Run ESLint |

### Project Structure

```
src/
├── mailgun-mcp.ts       # Core MCP logic (tools, API client, OpenAPI parsing)
├── index.ts             # STDIO entry point
├── http-server.ts       # HTTP/Express entry point with analytics
├── firebase-analytics.ts # Firebase analytics integration
└── openapi.yaml         # Mailgun OpenAPI specification
deploy/
└── nginx-mcp.conf       # Nginx location block template
Dockerfile               # Docker container definition
docker-compose.yml       # Docker Compose service config
```

## Security Considerations

### API key isolation

Your Mailgun API key is passed as an environment variable and is never exposed to the AI model itself — it is only used by the MCP server process to authenticate requests. The server does not log API keys, request parameters, or response data.

### API key permissions

Use a dedicated Mailgun API key with permissions scoped to only the operations you need. The server exposes read and update operations but does not expose any delete operations, which limits the blast radius of unintended actions.

### Rate limiting

The server does not implement client-side rate limiting. Each tool call from the AI translates directly into a Mailgun API request. The server relies on Mailgun's server-side rate limits to prevent abuse — requests that exceed those limits will return an error to the AI assistant.

### Input validation

All tool parameters are validated against the Mailgun OpenAPI specification using Zod schemas. However, validation depends on the accuracy of the OpenAPI spec, and some edge-case parameters may fall back to permissive validation. The Mailgun API performs its own server-side validation as an additional layer of protection.

## Debugging

- **STDIO mode**: Refer to the [MCP Debugging Guide](https://modelcontextprotocol.io/docs/tools/debugging)
- **HTTP mode**: Check `docker compose logs -f mcp-mailgun` and the `/analytics/dashboard` endpoint

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

## Contributing

We welcome contributions! Please feel free to submit a [Pull Request](https://github.com/hithereiamaliff/mcp-mailgun/pulls) or open an [Issue](https://github.com/hithereiamaliff/mcp-mailgun/issues).
