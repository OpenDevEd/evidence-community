# Coolify host firewall

`coolify-source-denylist.service` contains narrow, manually reviewed source-IP
blocks for traffic forwarded to Docker containers. These rules belong in
`DOCKER-USER`: Docker-published ports bypass ordinary host `INPUT` filtering.

The service is tied to `docker.service`, so its rules are applied after Docker
creates the chain and are reapplied when Docker starts again. Install an updated
unit on the Coolify host with:

```sh
sudo install -m 0644 coolify-source-denylist.service \
  /etc/systemd/system/coolify-source-denylist.service
sudo systemctl daemon-reload
sudo systemctl enable --now coolify-source-denylist.service
```

The current denylist contains `158.23.18.78/32`. It made 152 requests to
`coolify.opendeved.net` in roughly 34 seconds on 2026-08-31, probing 136 mostly
PHP, web-shell, and WordPress paths. Keep this list limited to sources confirmed
from the Traefik access log; broader bot networks belong in the library shield.
