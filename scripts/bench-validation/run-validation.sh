#!/usr/bin/env bash
#
# Reproducible Arch bench validation run with a throwaway Postgres.
#
# Brings up a disposable Postgres (docker compose), runs the strict, isolated,
# restore-from-spec migration slice of the internal benchmark against it,
# freezes the external dataset lock, and tears the database down. Raw logs,
# per-task results, failures, and timings land under a single run directory.
#
# The migration dbCheck RESETS the target database's `public` schema, so this
# only ever targets the disposable container below — never a real database.
#
# Usage:
#   scripts/bench-validation/run-validation.sh [OUT_DIR]
#
# Env:
#   ARCH_BENCH_KEEP_DB=1   leave the container running after the run
#   ARCH_BENCH_MAX_TASKS   cap tasks per subject (default 12, to reach migrations)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/scripts/bench-validation/docker-compose.yml"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT_DIR="${1:-$REPO_ROOT/artifacts/bench/validation-$STAMP}"
DB_URL="postgres://arch:arch@localhost:55432/arch_bench"
MAX_TASKS="${ARCH_BENCH_MAX_TASKS:-12}"

mkdir -p "$OUT_DIR"
echo "arch-bench validation: out=$OUT_DIR db=$DB_URL"

cleanup() {
  if [ "${ARCH_BENCH_KEEP_DB:-0}" != "1" ]; then
    echo "tearing down Postgres…"
    docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
  else
    echo "leaving Postgres up (ARCH_BENCH_KEEP_DB=1)"
  fi
}
trap cleanup EXIT

echo "starting throwaway Postgres…"
docker compose -f "$COMPOSE_FILE" up -d
# Wait for health.
for _ in $(seq 1 60); do
  if docker exec arch-bench-pg pg_isready -U arch -d arch_bench >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "1/4 strict manifest validation"
pnpm exec tsx "$REPO_ROOT/packages/arch-bench/src/main.ts" validate --strict | tee "$OUT_DIR/validate-strict.log"

echo "2/4 isolated + restore-from-spec migration slice (strict, real Postgres)"
ARCH_BENCH_DATABASE_URL="$DB_URL" \
  pnpm exec tsx "$REPO_ROOT/packages/arch-bench/src/main.ts" run --suite smoke \
    --subjects social-feed,task-tracker --baselines arch-typed-sync \
    --max-tasks "$MAX_TASKS" --task-mode isolated --failure-policy restore-from-spec --strict \
    --out "$OUT_DIR" | tee "$OUT_DIR/run.log"

echo "3/4 capability matrices"
pnpm exec tsx "$REPO_ROOT/packages/arch-bench/src/main.ts" capability-matrix --out "$OUT_DIR/capability-matrix.md"

echo "4/4 external demo run (real Arch CLI) + lock check"
# No `|| true`: an unversioned dataset edit is a policy violation and MUST fail
# the validation run loudly (set -o pipefail propagates the non-zero exit).
pnpm exec tsx "$REPO_ROOT/packages/arch-bench/src/main.ts" external lock --check | tee "$OUT_DIR/external-lock.log"
pnpm exec tsx "$REPO_ROOT/packages/arch-bench/src/main.ts" external run --out "$OUT_DIR/external" | tee "$OUT_DIR/external-run.log"
# Freeze the external dataset lock at the run root (artifact-directory convention).
cp "$REPO_ROOT/benchmarks/external/dataset.lock.json" "$OUT_DIR/dataset.lock.json"

echo "done. artifacts:"
echo "  $OUT_DIR/results.json | results.csv | summary.md"
echo "  $OUT_DIR/logs/<subject>/<baseline>/r<repeat>/<task>.log (+ .result.json)"
echo "  $OUT_DIR/failures/<task>.failure.json"
echo "  $OUT_DIR/external-metrics.json | external-summary.md | capability-matrix.md"
