#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -f Dockerfile.real-pi-test -t pi-account-pool-real-pi .
docker run --rm pi-account-pool-real-pi
