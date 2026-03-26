# MawaqitduGazole

Trouve instantanément la station-service la moins chere pres de chez toi. Une seule configuration, le prix se met a jour tout seul.

---

## Stack

| Composant | Technologie |
|-----------|-------------|
| Ingestion | Go 1.22 — open data gouvernemental, cron 10 min |
| API | C# ASP.NET Core 8 — REST + SignalR |
| Base de donnees | PostgreSQL 16 + PostGIS |
| Frontend | HTML / CSS / JS — zero framework |
| Infra | Docker Compose |

---

## Demarrage

```bash
git clone https://github.com/Redwane-stdy/MawaqitduGazole.git
cd MawaqitduGazole
bash scripts/dev.sh
```

Le frontend s'ouvre automatiquement dans le navigateur quand l'API est prete.

---

## API

| Methode | URL | Description |
|---------|-----|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/setup` | Configuration initiale — retourne `{ sessionId, cheapest }` |
| `GET` | `/api/cheapest?sessionId=` | Station la moins chere pour une session |
| `GET` | `/api/nearby?lat=&lng=&fuel=&radius=&limit=` | Stations proches sans session |
| `GET` | `/api/meta` | Statistiques base — `{ lastFetch, stationCount }` |
| `WS` | `/hub/prices` | SignalR — mises a jour temps reel |
| `GET` | `/logs` | Stream SSE des logs API |

Logs ingestion : `GET http://localhost:5001/logs`

---

## Tester l'API

```bash
go run scripts/test_api.go -lat=48.8566 -lng=2.3522 -fuel=Gazole -radius=10
```

---

## Donnees

Source : Prix des carburants en France — Ministere de l'Economie (open data, sans cle API).
Environ 11 000 stations, mise a jour toutes les 10 minutes.
