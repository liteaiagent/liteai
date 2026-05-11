---
title: Remote Control
description: "Access LiteAI from other devices on your network — mDNS discovery, auth, and CSRF."
---

# Remote Control

LiteAI can be accessed from other devices on your local network.

## Setup

Start the server with network binding:

```bash
liteai --host 0.0.0.0 --port 3000
```

## mDNS discovery

LiteAI advertises itself via mDNS (multicast DNS), allowing clients on the same network to discover it automatically. Look for the `_liteai._tcp` service.

## Authentication

For remote access, enable authentication:

```bash
export LITEAI_SERVER_USERNAME=admin
export LITEAI_SERVER_PASSWORD=your-secure-password
```

## CSRF protection

Remote connections require a CSRF token for API access:

```bash
export LITEAI_SERVER_CSRF_TOKEN=your-csrf-token
```

Include it in API requests via the `Authorization: Bearer` header:

```bash
curl -H "Authorization: Bearer your-csrf-token" http://server:3000/session
```

## Security recommendations

- **Always enable authentication** for network-exposed instances
- **Use HTTPS** via a reverse proxy (nginx, caddy) for production
- **Firewall** — Restrict access to trusted networks
- **CSRF tokens** — Always set for web client access

## What's next?

- [**Platforms overview**](/platforms/overview) — Feature comparison
- [**Architecture: Security model**](/architecture/security-model) — Security deep dive
