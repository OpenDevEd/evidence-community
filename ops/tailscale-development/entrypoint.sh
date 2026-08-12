#!/bin/sh
set -eu

socat TCP-LISTEN:3000,bind=127.0.0.1,reuseaddr,fork TCP:web:3000 &

exec /usr/local/bin/containerboot
