# Architecture — MawaqitduGazole

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (widget)                     │
│           HTML / CSS / JavaScript + SignalR              │
└──────────────────────┬──────────────────────────────────┘
                       │ REST + WebSocket (SignalR)
┌──────────────────────▼──────────────────────────────────┐
│               C# ASP.NET Core 8 — API                   │
│  POST /api/setup    GET /api/cheapest   GET /api/nearby  │
│  GET  /api/meta     SignalR Hub /hub/prices              │
│  BackgroundService PricePusher (push every 10 min)       │
└──────────────────────┬──────────────────────────────────┘
                       │ Npgsql / Dapper
┌──────────────────────▼──────────────────────────────────┐
│           PostgreSQL 16 + PostGIS 3.4                   │
│  gas_stations  fuel_prices  user_sessions  ingestion_log │
│  Géospatial ST_DWithin() pour les requêtes de proximité  │
└──────────────────────┬──────────────────────────────────┘
                       │ pgx/v5
┌──────────────────────▼──────────────────────────────────┐
│            Go — Service d'ingestion                      │
│  Télécharge le flux open-data du gouvernement français   │
│  toutes les 10 minutes (ZIP XML → parse → upsert PG)     │
└─────────────────────────────────────────────────────────┘
                       ↑
          https://donnees.roulez-eco.fr/opendata/instantane
          (Open data officiel — aucune clé API requise)
```

## Composants

### 1. Go — Service d'ingestion (`/ingestion`)
- Télécharge le ZIP contenant le XML du gouvernement
- Parse ~11 000 stations avec leurs prix (6 carburants)
- Upsert dans PostgreSQL via transaction batch
- Planifié toutes les 10 minutes avec `robfig/cron`
- Retry automatique au démarrage (attend que Postgres soit prêt)

### 2. C# ASP.NET Core — API (`/api`)
- `StationsController` : endpoints REST
- `PriceHub` (SignalR) : WebSocket pour les mises à jour live
- `PricePusher` : BackgroundService qui pousse les prix toutes les 10 min
- `StationService` : requêtes géospatiales PostGIS

### 3. PostgreSQL + PostGIS (`/database`)
- `gas_stations` : colonne `location GEOGRAPHY(POINT)` générée automatiquement
- `fuel_prices` : unique par `(station_id, fuel_type)`, upsert à chaque fetch
- `user_sessions` : stocke les préférences utilisateur (anonymes)
- Index GIST sur `location` pour `ST_DWithin()` ultra-rapide

### 4. Frontend (`/frontend`)
- Page HTML unique, zéro framework
- Détection GPS via l'API Geolocation du navigateur
- SignalR client : reçoit les prix en push, sans polling
- Design inspiré de Mawaqit : grand prix centré, fond sombre

## Flux UX (comme Mawaqit)

```
1ère visite → Sélectionner carburant + GPS  →  POST /api/setup
                                                ↓
                                            sessionId sauvé en localStorage
                                            Prix affiché immédiatement
                                                ↓
                                            SignalR connecté → Subscribe(sessionId)
                                                ↓
                                   Toutes les 10 min → PriceUpdate pushé
                                   sans que l'utilisateur ne fasse rien
```

## Source de données

**Prix des carburants en France — flux instantané v2**
- Producteur : Ministère de l'Économie
- Licence : Licence Ouverte / Open Licence
- Mise à jour : plusieurs fois par jour
- Couverture : ~11 000 stations-service
- Format : ZIP contenant un XML
- URL : `https://donnees.roulez-eco.fr/opendata/instantane`

## Performances

- **Requête géospatiale** : `ST_DWithin` avec index GIST → < 5ms sur 11k stations
- **SignalR push** : latence < 100ms entre le fetch et l'affichage client
- **Ingestion** : 11k stations × 6 prix ≈ 66k rows en ~3-5s en batch
