#!/usr/bin/env bash
# scripts/dev.sh — Lance l'environnement de développement local.
#
# Usage :
#   bash scripts/dev.sh
#
# Démarre tous les services via docker compose et s'assure qu'un
# Ctrl+C (SIGINT) ou SIGTERM arrête proprement les containers,
# libère les ports et les supprime.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.yml"

cleanup() {
  echo ""
  echo "[dev.sh] Signal reçu — arrêt et suppression des containers..."
  docker compose -f "$COMPOSE_FILE" down
  echo "[dev.sh] Environnement arrêté. Ports libérés."
  exit 0
}

trap cleanup SIGINT SIGTERM

echo "[dev.sh] Démarrage de MawaqitduGazole..."
echo "[dev.sh] Ctrl+C pour tout arrêter proprement."
echo ""

docker compose -f "$COMPOSE_FILE" up --build &
COMPOSE_PID=$!

# Attendre que l'API soit prête, puis ouvrir le frontend
(
  echo "[dev.sh] En attente de l'API sur http://localhost:5050/health..."
  until curl -sf http://localhost:5050/health > /dev/null 2>&1; do
    sleep 1
  done
  echo "[dev.sh] API prête — ouverture du frontend..."
  open "$ROOT/frontend/index.html"
) &

wait "$COMPOSE_PID"
