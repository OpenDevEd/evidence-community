FROM tailscale/tailscale:v1.98.10@sha256:cdf5612ded5be1344f1a704b8c5e53496db97376bb533e5e15f141e48bf60cc0

RUN apk add --no-cache socat=1.8.1.3-r0

COPY ops/tailscale-development/serve.json /config/serve.json
COPY ops/tailscale-development/entrypoint.sh /usr/local/bin/openscholar-tailscale-entrypoint

CMD ["/usr/local/bin/openscholar-tailscale-entrypoint"]
