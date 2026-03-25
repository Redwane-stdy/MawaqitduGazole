// Package store handles all PostgreSQL operations for the ingestion service.
package store

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"

	"github.com/Redwane-stdy/mawaqit-du-gazole/ingestion/internal/parser"
)

// Store wraps a *sql.DB connection pool.
type Store struct {
	db *sql.DB
}

// New opens a connection pool and verifies connectivity.
func New(dsn string) (*Store, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("sql.Open: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetConnMaxLifetime(time.Minute * 5)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() { s.db.Close() }

// UpsertStations bulk-upserts stations and their prices.
func (s *Store) UpsertStations(ctx context.Context, stations []parser.ParsedStation) (int, int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	stmtStation, err := tx.PrepareContext(ctx, `
		INSERT INTO gas_stations (id, address, city, postal_code, latitude, longitude, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (id) DO UPDATE SET
			address     = EXCLUDED.address,
			city        = EXCLUDED.city,
			postal_code = EXCLUDED.postal_code,
			latitude    = EXCLUDED.latitude,
			longitude   = EXCLUDED.longitude,
			updated_at  = EXCLUDED.updated_at
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("prepare station stmt: %w", err)
	}
	defer stmtStation.Close()

	stmtPrice, err := tx.PrepareContext(ctx, `
		INSERT INTO fuel_prices (station_id, fuel_type, price, recorded_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (station_id, fuel_type) DO UPDATE SET
			price       = EXCLUDED.price,
			recorded_at = EXCLUDED.recorded_at
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("prepare price stmt: %w", err)
	}
	defer stmtPrice.Close()

	now := time.Now()
	stationCount := 0
	priceCount := 0

	for _, st := range stations {
		_, err := stmtStation.ExecContext(ctx,
			st.ID, st.Address, st.City, st.PostCode, st.Latitude, st.Longitude, now)
		if err != nil {
			log.Printf("[store] skip station %d: %v", st.ID, err)
			continue
		}
		stationCount++

		for _, p := range st.Prices {
			_, err := stmtPrice.ExecContext(ctx, st.ID, p.FuelType, p.Price, now)
			if err != nil {
				log.Printf("[store] skip price station=%d fuel=%s: %v", st.ID, p.FuelType, err)
				continue
			}
			priceCount++
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, fmt.Errorf("commit: %w", err)
	}
	return stationCount, priceCount, nil
}

// LogIngestion records a summary of the last fetch.
func (s *Store) LogIngestion(ctx context.Context, stations, prices, durationMs int, success bool, errMsg string) {
	var errPtr *string
	if errMsg != "" {
		errPtr = &errMsg
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO ingestion_log (stations_cnt, prices_cnt, duration_ms, success, error_msg)
		VALUES ($1, $2, $3, $4, $5)
	`, stations, prices, durationMs, success, errPtr)
	if err != nil {
		log.Printf("[store] log ingestion failed: %v", err)
	}
}
