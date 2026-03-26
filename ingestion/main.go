package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/Redwane-stdy/mawaqit-du-gazole/ingestion/internal/fetcher"
	"github.com/Redwane-stdy/mawaqit-du-gazole/ingestion/internal/parser"
	"github.com/Redwane-stdy/mawaqit-du-gazole/ingestion/internal/store"
)

// ── SSE log hub ───────────────────────────────────────────────────────────

type logHub struct {
	mu      sync.Mutex
	clients map[chan string]struct{}
}

var hub = &logHub{clients: make(map[chan string]struct{})}

func (h *logHub) subscribe() chan string {
	ch := make(chan string, 64)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *logHub) unsubscribe(ch chan string) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}

func (h *logHub) publish(line string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- line:
		default: // slow client — drop
		}
	}
}

// ── Custom log writer — writes to stdout AND broadcasts to SSE clients ────

type broadcastWriter struct {
	stdout io.Writer
}

func (w *broadcastWriter) Write(p []byte) (int, error) {
	n, err := w.stdout.Write(p)
	msg := string(bytes.TrimRight(p, "\n"))

	level := "INFO"
	if len(msg) > 0 && (contains(msg, "error") || contains(msg, "fatal")) {
		level = "ERROR"
	} else if contains(msg, "warn") {
		level = "WARN"
	}

	entry := map[string]string{
		"ts":      time.Now().UTC().Format("15:04:05"),
		"channel": "INGESTION",
		"level":   level,
		"msg":     msg,
	}
	if b, jerr := json.Marshal(entry); jerr == nil {
		hub.publish(string(b))
	}
	return n, err
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub ||
		(func() bool {
			for i := 0; i <= len(s)-len(sub); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
			return false
		})())
}

// ── SSE HTTP handler ──────────────────────────────────────────────────────

func logsHandler(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	flusher.Flush()

	ch := hub.subscribe()
	defer hub.unsubscribe(ch)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case line, open := <-ch:
			if !open {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", line)
			flusher.Flush()
		}
	}
}

func main() {
	// Redirect standard logger to our broadcast writer
	log.SetOutput(&broadcastWriter{stdout: os.Stderr})
	log.SetFlags(log.Ldate | log.Ltime | log.Lmsgprefix)
	log.SetPrefix("[ingestion] ")

	dsn := env("DATABASE_URL", "postgres://gazole:gazole@localhost:5432/gazole?sslmode=disable")

	// Start SSE log server in background
	go func() {
		mux := http.NewServeMux()
		mux.HandleFunc("/logs", logsHandler)
		log.Println("log SSE server listening on :5001")
		if err := http.ListenAndServe(":5001", mux); err != nil {
			log.Printf("log server error: %v", err)
		}
	}()

	ctx := context.Background()

	log.Println("connecting to database…")
	var st *store.Store
	var err error

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

	run(ctx, st)

	c := cron.New()
	if _, err := c.AddFunc("*/10 * * * *", func() { run(ctx, st) }); err != nil {
		log.Fatalf("cron setup: %v", err)
	}
	c.Start()
	log.Println("scheduler started — fetching every 10 minutes")

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
