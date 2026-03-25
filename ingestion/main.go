package main

import (
	"bytes"
	"context"
	"log"
	"os"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/Redwane-stdy/mawaqit-du-gazole/ingestion/internal/fetcher"
	"github.com/Redwane-stdy/mawaqit-du-gazole/ingestion/internal/parser"
	"github.com/Redwane-stdy/mawaqit-du-gazole/ingestion/internal/store"
)

func main() {
	dsn := env("DATABASE_URL", "postgres://gazole:gazole@localhost:5432/gazole?sslmode=disable")

	log.SetFlags(log.Ldate | log.Ltime | log.Lmsgprefix)
	log.SetPrefix("[ingestion] ")

	ctx := context.Background()

	log.Println("connecting to database…")
	var st *store.Store
	var err error

	// Retry loop: wait for Postgres to be ready (useful in docker-compose startup)
	for i := 0; i < 15; i++ {
		st, err = store.New(dsn)
		if err == nil {
			break
		}
		log.Printf("db not ready (%v), retrying in 3s…", err)
		time.Sleep(3 * time.Second)
	}
	if err != nil {
		log.Fatalf("cannot connect to database: %v", err)
	}
	defer st.Close()
	log.Println("database connected ✓")

	// Initial fetch on startup
	run(ctx, st)

	// Then every 10 minutes
	c := cron.New()
	if _, err := c.AddFunc("*/10 * * * *", func() { run(ctx, st) }); err != nil {
		log.Fatalf("cron setup: %v", err)
	}
	c.Start()
	log.Println("scheduler started — fetching every 10 minutes")

	// Block forever
	select {}
}

func run(ctx context.Context, st *store.Store) {
	start := time.Now()
	log.Println("starting fetch…")

	xmlData, err := fetcher.FetchXML()
	if err != nil {
		elapsed := int(time.Since(start).Milliseconds())
		log.Printf("fetch error: %v", err)
		st.LogIngestion(ctx, 0, 0, elapsed, false, err.Error())
		return
	}

	stations, err := parser.Parse(bytes.NewReader(xmlData))
	if err != nil {
		elapsed := int(time.Since(start).Milliseconds())
		log.Printf("parse error: %v", err)
		st.LogIngestion(ctx, 0, 0, elapsed, false, err.Error())
		return
	}
	log.Printf("parsed %d stations", len(stations))

	stCnt, prCnt, err := st.UpsertStations(ctx, stations)
	elapsed := int(time.Since(start).Milliseconds())
	if err != nil {
		log.Printf("upsert error: %v", err)
		st.LogIngestion(ctx, 0, 0, elapsed, false, err.Error())
		return
	}

	log.Printf("upserted %d stations, %d prices in %dms ✓", stCnt, prCnt, elapsed)
	st.LogIngestion(ctx, stCnt, prCnt, elapsed, true, "")
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
