# Private development deployment

This folder holds the Tailscale Serve configuration and the live boundary
probe for the isolated development Evidence Library.

Use `docker/compose.tailscale-development.yaml`. It is the only repository
deployment that enables `ADMIN_AUTH_BYPASS=true`. It must never have a Coolify
domain or host port.

The full setup, deployment order, verification, and rollback instructions are
in `docs/evidence-library-operations.md` under **Private Tailscale development
deployment**.

After deployment, run:

```bash
ops/tailscale-development/probe.sh \
  http://openscholar-el-dev.tail40de7d.ts.net \
  https://docs-openscholar-compose-e2e.opendev.space
```
