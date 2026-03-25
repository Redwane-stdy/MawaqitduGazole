# ⛽ MawaqitduGazole

> Le prix de l'essence le moins cher près de chez vous — affiché **avant même que vous l'ayez demandé**.

Inspiré de [Mawaqit](https://mawaqit.net) (les horaires de prière en temps réel), **MawaqitduGazole** est un widget minimaliste qui vous montre instantanément la station-service la moins chère dans votre rayon. Une seule configuration, et le prix s'actualise tout seul.

---

## Aperçu

```
┌─────────────────────────┐
│  ⛽ MawaqitduGazole   ✎ │
│                         │
│        1,749            │
│         €/L             │
│                         │
│  Total Energies, Paris  │
│     à 1.2 km            │
│         [Diesel]        │
│                         │
│  Mis à jour il y a 3min │
│  · 11 247 stations      │
└─────────────────────────┘
```

---

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Ingestion | **Go 1.22** — fetch + parse du flux open-data gouvernemental |
| API       | **C# ASP.NET Core 8** — REST + SignalR (WebSocket) |
| Base de données | **PostgreSQL 16 + PostGIS 3.4** — requêtes géospatiales |
| Frontend  | **HTML / CSS / JS** — zéro framework, design minimaliste |
| Infra     | **Docker Compose** — un seul `docker-compose up` |

---

## Données

Source officielle et gratuite : **Prix des carburants en France (flux instantané v2)**
- Producteur : Ministère de l'Économie
- Licence : Ouverte — aucune clé API requise
- ~11 000 stations couvrant toute la France
- Mise à jour automatique toutes les **10 minutes**
- Carburants : Diesel · SP95 · SP98 · E10 · E85 · GPL

---

## Démarrage rapide

### Prérequis

- [Docker](https://www.docker.com/) + Docker Compose
- Un navigateur moderne (Chrome, Firefox, Safari)

### Lancement

```bash
git clone https://github.com/Redwane-stdy/MawaqitduGazole.git
cd MawaqitduGazole

docker-compose up --build
```

Au démarrage, les logs affichent :
```
gazole_ingestion | [ingestion] connecting to database…
gazole_ingestion | [ingestion] database connected ✓
gazole_ingestion | [fetcher] downloading fuel prices from https://…
gazole_ingestion | [ingestion] parsed 11 247 stations
gazole_ingestion | [ingestion] upserted 11 247 stations, 54 312 prices in 4231ms ✓
```

### Ouvrir le widget

Ouvrez simplement `frontend/index.html` dans votre navigateur (double-clic ou glisser-déposer).

> L'API tourne sur `http://localhost:5000`.

---

## Utilisation

1. **Première visite** : choisissez votre carburant et autorisez la géolocalisation GPS
2. **Résultat immédiat** : le prix de la station la moins chère s'affiche
3. **Mise à jour automatique** : via SignalR, le prix se rafraîchit sans action de votre part
4. **Top 5** : les 5 stations les moins chères dans votre rayon sont listées en bas

---

## Endpoints API

| Méthode | URL | Description |
|---------|-----|-------------|
| `POST` | `/api/setup` | Première configuration (carburant + position) |
| `GET`  | `/api/cheapest?sessionId=…` | Prix le moins cher pour la session |
| `GET`  | `/api/nearby?lat=&lng=&fuel=&radius=` | Requête directe sans session |
| `GET`  | `/api/meta` | Statistiques de la base (stations, dernière MAJ) |
| `WS`   | `/hub/prices` | SignalR — mises à jour en temps réel |
| `GET`  | `/health` | Health check |

---

## Architecture

```
Browser (widget)
    │ SignalR + REST
    ▼
C# ASP.NET Core API  ──── PricePusher (Background, 10 min)
    │ Npgsql/Dapper
    ▼
PostgreSQL 16 + PostGIS  ◄─── Go ingestion (cron 10 min)
                                    │
                              data.gouv.fr (open data)
```

Voir [docs/architecture.md](docs/architecture.md) pour le détail complet.

---

## Structure du projet

```
MawaqitduGazole/
├── ingestion/          # Go — service d'ingestion des prix
│   ├── main.go
│   ├── internal/
│   │   ├── fetcher/    # Téléchargement du ZIP gouvernemental
│   │   ├── parser/     # Décodage XML → struct Go
│   │   └── store/      # Upsert PostgreSQL
│   └── Dockerfile
├── api/                # C# ASP.NET Core — API REST + SignalR
│   ├── Controllers/    # StationsController
│   ├── Hubs/           # PriceHub (SignalR)
│   ├── Services/       # StationService + PricePusher
│   ├── Models/
│   ├── Data/
│   └── Dockerfile
├── frontend/           # Widget HTML/CSS/JS
│   ├── index.html
│   ├── style.css
│   └── app.js
├── database/
│   └── init.sql        # Schéma PostgreSQL + PostGIS
├── docs/
│   └── architecture.md
└── docker-compose.yml
```

---

## Développement local (sans Docker)

**PostgreSQL** (avec PostGIS installé) :
```bash
psql -U postgres -c "CREATE USER gazole WITH PASSWORD 'gazole';"
psql -U postgres -c "CREATE DATABASE gazole OWNER gazole;"
psql -U gazole -d gazole -f database/init.sql
```

**Go ingestion** :
```bash
cd ingestion
go mod download
DATABASE_URL="postgres://gazole:gazole@localhost:5432/gazole?sslmode=disable" go run main.go
```

**C# API** :
```bash
cd api
dotnet run
# API disponible sur http://localhost:5000
```

**Frontend** : ouvrir `frontend/index.html` directement dans le navigateur.

---

## Roadmap

- [ ] Déploiement Vercel (frontend) + Railway/Render (API + DB)
- [ ] Application mobile React Native
- [ ] Notifications push quand un prix baisse dans votre zone
- [ ] Historique des prix (graphe sur 30 jours)
- [ ] Filtre par enseigne (Total, BP, Leclerc…)
