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

> L'API tourne sur `http://localhost:5050`.

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
# API disponible sur http://localhost:5050
```

**Frontend** : ouvrir `frontend/index.html` directement dans le navigateur.

---

## Roadmap

- [ ] Déploiement Vercel (frontend) + Railway/Render (API + DB)
- [ ] Application mobile React Native
- [ ] Notifications push quand un prix baisse dans votre zone
- [ ] Historique des prix (graphe sur 30 jours)
- [ ] Filtre par enseigne (Total, BP, Leclerc…)

---

## Développement local — lancement propre

Utiliser le script `scripts/dev.sh` plutôt que `docker-compose up` directement :

```bash
bash scripts/dev.sh
```

Un Ctrl+C (ou signal SIGTERM) déclenche automatiquement `docker compose down` — les containers sont stoppés **et supprimés**, les ports sont libérés immédiatement.

---

## Calcul "station la moins chère la plus proche"

### Algorithme implémenté

La recherche est entièrement déléguée à **PostGIS** via `ST_Distance` et `ST_DWithin`, opérant sur la colonne `location GEOGRAPHY(POINT)`. Le type `GEOGRAPHY` utilise un modèle ellipsoïdal WGS 84 — plus précis que la formule de Haversine. La distance retournée est la **distance en ligne droite** (vol d'oiseau), pas le trajet routier.

Critère de tri dans `StationService.GetCheapestAsync` :

```sql
ORDER BY fp.price ASC, DistanceKm ASC
LIMIT 1
```

La station retournée est celle au **prix unitaire le plus bas** dans le rayon. En cas d'égalité, la plus proche est préférée. Ce n'est **pas** la station au coût total le plus avantageux.

### Coût de trajet — non implémenté

La consommation du véhicule n'est pas prise en compte. Aller chercher du carburant à 15 km peut coûter plus cher en carburant brûlé que de faire le plein à une station plus chère à 2 km.

Le calcul d'optimisation réelle :

```
coût_total(station) = prix_station × volume_plein
                    + (distanceKm × 2 × conso_L_per_100km / 100) × prix_station
```

La station optimale minimise `coût_total`, pas le tarif unitaire.

### Exemple chiffré

Hypothèses : plein de 50 L, consommation 6 L/100 km.

| Station | Prix (€/L) | Distance (km) | Coût trajet A/R (€) | Coût total (€) |
|---------|-----------|---------------|---------------------|----------------|
| Leclerc | 1,699 | 8,0 | 1,63 € | **86,58 €** |
| Total | 1,749 | 1,2 | 0,25 € | **87,70 €** |
| Autoroute | 1,820 | 0,3 | 0,07 € | **91,07 €** |

Leclerc est la moins chère à l'unité mais la plus chère en coût réel — l'algorithme actuel la retournerait à tort pour un rayon de 10 km.

Pour implémenter ce calcul : exposer `consoLPer100` dans `POST /api/setup`, le stocker en session, et modifier le tri pour scorer sur `coût_total`.

---

## Images Docker — architectures supportées

### Analyse

**`ingestion/Dockerfile`** (Go) : compile sans `GOARCH` explicite → cible l'architecture de la machine hôte. `arm64` sur Apple Silicon, `amd64` sur un serveur Linux x86-64. Aucune image multi-arch.

**`api/Dockerfile`** (C# .NET 8) : les images de base `mcr.microsoft.com/dotnet/sdk:8.0` sont multi-arch, mais sans `--platform` le build cible l'hôte uniquement.

| Image | amd64 | arm64 (Apple Silicon) | Multi-arch |
|-------|-------|-----------------------|------------|
| `postgis/postgis:16-3.4` | ✓ | ✓ | ✓ (registry officiel) |
| `ingestion` (build local) | selon hôte | selon hôte | ✗ |
| `api` (build local) | selon hôte | selon hôte | ✗ |

### Construire des images multi-platform

```bash
# Créer un builder multi-platform (une seule fois)
docker buildx create --name multiarch --use

# Construire et pousser
docker buildx build --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/youruser/mawaqitdugazole-api:latest --push ./api

docker buildx build --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/youruser/mawaqitdugazole-ingestion:latest --push ./ingestion
```

Pour le Dockerfile Go, ajouter `TARGETARCH` pour le cross-compile :
```dockerfile
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -o ingestion ./main.go
```

---

## Temps de réponse — cibles et mesurés

### Cibles industrie

| Type de requête | Cible acceptable | Cible idéale |
|----------------|-----------------|--------------|
| API géospatiale (lecture) | < 200 ms | < 50 ms |
| Setup initial (écriture + lecture) | < 500 ms | < 200 ms |
| Push SignalR (latence réseau incluse) | < 500 ms | < 100 ms |
| Health check | < 50 ms | < 10 ms |

### Estimation des temps réels

**`GET /api/nearby` / `GET /api/cheapest`** : `ST_DWithin` + index GIST sur 11 000 stations → **5–30 ms**. Très en dessous des cibles.

**`POST /api/setup`** : deux aller-retours DB séquentiels → **15–60 ms**. Acceptable.

**`GET /api/meta`** : `COUNT(*)` sur `fuel_prices` (~66 000 lignes) — risque de **20–100 ms** sans `VACUUM ANALYZE` régulier.

**SignalR `PriceUpdate`** : `PricePusher` itère séquentiellement. À 100 sessions actives : ~1–3 s de traitement total. Chaque client reçoit sa mise à jour à son tour — la latence perçue augmente avec le nombre de sessions.

### Recommandations

- Cache `IMemoryCache` sur `GetMetaAsync` (TTL 60 s) pour éviter les `COUNT(*)` répétés.
- Paralléliser `PushAllAsync` avec `Task.WhenAll` + `SemaphoreSlim`.
- OpenTelemetry → Prometheus/Grafana pour mesurer en production.

---

## Perspectives de déploiement — Widget et Web App

### Widget embarquable

**Option 1 — iframe** :
```html
<iframe src="https://widget.mawaqitdugazole.fr" width="320" height="400"
        frameborder="0" allow="geolocation" loading="lazy"></iframe>
```
L'attribut `allow="geolocation"` est **obligatoire** pour que l'API GPS fonctionne depuis un iframe cross-origin. L'architecture actuelle tient sans modification.

**Option 2 — Web Component** :
```html
<script src="https://widget.mawaqitdugazole.fr/widget.js"></script>
<mawaqit-gazole fuel="Gazole" radius="5"></mawaqit-gazole>
```
Nécessite de réécrire `app.js` comme un Custom Element avec shadow DOM. Le backend ne change pas.

### PWA / Web App

Ajouts pour une PWA complète :
1. `manifest.json` — nom, icônes, `display: standalone`
2. Service Worker — cache des assets, offline shell
3. HTTPS — obligatoire pour Geolocation et SignalR WSS

| Composant | Hébergement recommandé |
|-----------|------------------------|
| Frontend statique | Vercel / Netlify / Cloudflare Pages |
| API C# | Railway, Fly.io, Render |
| PostgreSQL + PostGIS | Supabase, Neon, Railway |
| SignalR multi-instance | Backplane Redis ou Azure SignalR Service |

**Ce qui doit changer** : `API_BASE` hardcodé à `localhost:5000` dans `app.js` → configurable via variable d'environnement. CORS à activer pour l'origine déployée.

---

## Soutenabilité de l'architecture

### Ce qui est solide

- **Go ingestion** : binaire statique ~15 MB, démarrage rapide, idéal pour une tâche de fond périodique.
- **PostGIS** : index GIST + `ST_DWithin` — solution industrielle standard. < 10 ms à 11 000 stations, même avec des centaines de req/s.
- **ASP.NET Core + SignalR** : Kestrel supporte 10 000+ connexions WebSocket simultanées sur un seul serveur.
- **Frontend vanilla** : zéro dépendance, charge instantanée, parfait pour un widget embarquable.
- **Docker Compose** : `docker-compose up` — aucune sur-ingénierie.

### Points de fragilité

| Problème | Impact | Correction |
|----------|--------|------------|
| `PricePusher` boucle séquentielle | Latence ↑ avec le nb de sessions | `Task.WhenAll` + `SemaphoreSlim` |
| Pas de cache applicatif | Requêtes PostGIS redondantes | Cache TTL 60–120 s par `(lat, lng, fuel, radius)` |
| `user_sessions` sans purge | Table grossit indéfiniment | `DELETE WHERE last_seen < NOW() - INTERVAL '7 days'` |
| `dynamic` dans PricePusher | Erreurs de schéma à l'exécution | Remplacer par un DTO typé `SessionDto` |
| `API_BASE` hardcodé | Non déployable sans modification | Variable d'environnement injectée au build |
| Pas de rate limiting | Exposition publique risquée | Middleware `RateLimiter` (.NET 7+) |

### Verdict

L'architecture tient parfaitement pour un usage personnel ou un trafic modéré (< 1 000 utilisateurs actifs simultanés). Deux corrections prioritaires avant une mise en production publique : **paralléliser PricePusher** et **ajouter un cache**. Aucune refonte fondamentale n'est requise.
