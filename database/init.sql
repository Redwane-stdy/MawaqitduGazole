-- ============================================================
-- MawaqitduGazole — Database initialization
-- PostgreSQL + PostGIS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------
-- Gas stations
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gas_stations (
    id          BIGINT PRIMARY KEY,
    name        VARCHAR(255),
    brand       VARCHAR(100),
    address     TEXT,
    city        VARCHAR(100),
    postal_code VARCHAR(10),
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    location    GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
                ) STORED,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stations_location ON gas_stations USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_stations_postal    ON gas_stations(postal_code);

-- ----------------------------------------------------------------
-- Fuel prices  (one row per station × fuel_type, upserted every 10 min)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_prices (
    id          SERIAL PRIMARY KEY,
    station_id  BIGINT      NOT NULL REFERENCES gas_stations(id) ON DELETE CASCADE,
    fuel_type   VARCHAR(20) NOT NULL,   -- Gazole | SP95 | SP98 | E10 | E85 | GPLc
    price       NUMERIC(6,3) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (station_id, fuel_type)
);

CREATE INDEX IF NOT EXISTS idx_prices_station   ON fuel_prices(station_id);
CREATE INDEX IF NOT EXISTS idx_prices_fuel_type ON fuel_prices(fuel_type);
CREATE INDEX IF NOT EXISTS idx_prices_recorded  ON fuel_prices(recorded_at);

-- ----------------------------------------------------------------
-- User sessions  (anonymous, identified by UUID stored in localStorage)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fuel_type   VARCHAR(20)       NOT NULL,
    latitude    DOUBLE PRECISION  NOT NULL,
    longitude   DOUBLE PRECISION  NOT NULL,
    address     TEXT,
    radius_km   INTEGER           NOT NULL DEFAULT 5,
    created_at  TIMESTAMPTZ       DEFAULT NOW(),
    last_seen   TIMESTAMPTZ       DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- Ingestion metadata  (track last successful fetch)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_log (
    id           SERIAL PRIMARY KEY,
    fetched_at   TIMESTAMPTZ DEFAULT NOW(),
    stations_cnt INTEGER,
    prices_cnt   INTEGER,
    duration_ms  INTEGER,
    success      BOOLEAN DEFAULT TRUE,
    error_msg    TEXT
);
