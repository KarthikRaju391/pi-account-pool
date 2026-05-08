#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker build -f Dockerfile.test -t pi-account-pool-smoke .
docker run --rm pi-account-pool-smoke
