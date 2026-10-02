#!/usr/bin/env bash
set -euo pipefail
TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_COMPOSE=(docker compose -f "$TASK_DIR/compose.yaml")
mkdir -p "$TASK_DIR/artifacts"
"${TASK_COMPOSE[@]}" build app test
"${TASK_COMPOSE[@]}" up --detach --wait --wait-timeout 180 app email webhook gateway
"${TASK_COMPOSE[@]}" run --rm --no-deps test
"${TASK_COMPOSE[@]}" restart app
"${TASK_COMPOSE[@]}" up --detach --no-deps --wait --wait-timeout 120 app
"${TASK_COMPOSE[@]}" run --rm --no-deps test node --test -r ts-node/register -r tsconfig-paths/register tests/notifications.persistence.ts
printf '\nContainer stack is running for inspection at http://localhost:%s\n' "${CONTAINER_TEST_APP_PORT:-24870}"
printf 'Report and demo login: %s/artifacts/report.json\n' "$TASK_DIR"
printf 'Stop: docker compose -f tests/containers/compose.yaml down\n'
