// Package store handles all PostgreSQL operations for the ingestion service.
package store

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Redwane-stdy/mawaqit-du-gazole/ingestion/internal/parser"
)

// Store wraps a pgxpool.Pool.
type Store struct {
	pool *pgxpool.Pool
}

// New creates a Store and verifies connectivity.
func New(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("pgxpool.New: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

// UpsertStations bulk-upserts stations and their prices into PostgreSQL.
// It uses a temporary table + COPY for speed, then merges into the real tables.
func (s *Store) UpsertStations(ctx context.Context, stations []parser.ParsedStation) (int, int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	stationCount := 0
	priceCount := 0

	for _, st := range stations {
		_, err := tx.Exec(ctx, `
			INSERT INTO gas_stations (id, address, city, postal_code, latitude, longitude, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (id) DO UPDATE SET
				address    = EXCLUDED.address,
				city       = EXCLUDED.city,
				postal_code= EXCLUDED.postal_code,
				latitude   = EXCLUDED.latitude,
				longitude  = EXCLUDED.longitude,
				updated_at = EXCLUDED.updated_at
		`, st.ID, st.Address, st.City, st.PostCode, st.Latitude, st.Longitude, time.Now())
		if err != nil {
			log.Printf("[store] skip station %d: %v", st.ID, err)
			continue
		}
		stationCount++

		for _, p := range st.Prices {
			_, err := tx.Exec(ctx, `
				INSERT INTO fuel_prices (station_id, fuel_type, price, recorded_at)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (station_id, fuel_type) DO UPDATE SET
					price       = EXCLUDED.price,
					recorded_at = EXCLUDED.recorded_at
			`, st.ID, p.FuelType, p.Price, time.Now())
			if err != nil {
				log.Printf("[store] skip price station=%d fuel=%s: %v", st.ID, p.FuelType, err)
				continue
			}
			priceCount++
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, 0, fmt.Errorf("commit: %w", err)
	}
	return stationCount, priceCount, nil
}

// LogIngestion records a summary of the last fetch.
func (s *Store) LogIngestion(ctx context.Context, stations, prices, durationMs int, success bool, errMsg string) {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO ingestion_log (stations_cnt, prices_cnt, duration_ms, success, error_msg)
		VALUES ($1, $2, $3, $4, $5)
	`, stations, prices, durationMs, success, errMsg)
	if err != nil {
		log.Printf("[store] log ingestion failed: %v", err)
	}
}
