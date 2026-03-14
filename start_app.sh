#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
CLIENT_DIR="${SCRIPT_DIR}/client"

export PYTHONPATH="${PYTHONPATH:-${SCRIPT_DIR}}"

backend_pid=""
client_pid=""

cleanup() {
    trap - EXIT INT TERM

    local pids=()
    [[ -n "${backend_pid}" ]] && pids+=("${backend_pid}")
    [[ -n "${client_pid}" ]] && pids+=("${client_pid}")

    if ((${#pids[@]} == 0)); then
        return
    fi

    for pid in "${pids[@]}"; do
        if kill -0 "${pid}" 2>/dev/null; then
            kill "${pid}" 2>/dev/null || true
        fi
    done

    wait "${pids[@]}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

cd "${BACKEND_DIR}"
uv sync --group dev
uv run uvicorn backend.server.app:app --port 8000 &
backend_pid=$!

cd "${CLIENT_DIR}"
npm ci
npm run dev -- --port 5173 &
client_pid=$!

pids=("${backend_pid}" "${client_pid}")
while ((${#pids[@]} > 0)); do
    status=0
    wait -n "${pids[@]}" || status=$?
    if ((status != 0)); then
        exit "${status}"
    fi

    remaining_pids=()
    for pid in "${pids[@]}"; do
        if kill -0 "${pid}" 2>/dev/null; then
            remaining_pids+=("${pid}")
        fi
    done
    pids=("${remaining_pids[@]}")
done
