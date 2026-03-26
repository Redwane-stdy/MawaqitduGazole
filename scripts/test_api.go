//go:build ignore

// Test script — MawaqitduGazole API
//
// Usage:
//   go run scripts/test_api.go
//   go run scripts/test_api.go -lat=48.8566 -lng=2.3522 -fuel=Gazole -radius=5
//
// Prérequis : bash scripts/dev.sh doit tourner.

package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// ── ANSI couleurs ─────────────────────────────────────────────
const (
	reset  = "\033[0m"
	bold   = "\033[1m"
	green  = "\033[32m"
	red    = "\033[31m"
	yellow = "\033[33m"
	cyan   = "\033[36m"
	dim    = "\033[2m"
)

var (
	apiBase = "http://localhost:5050"
	ingBase = "http://localhost:5001"
	passed  int
	failed  int
)

func ok(label, detail string) {
	passed++
	fmt.Printf("  %s✓%s %s%s%s %s%s%s\n", green+bold, reset, bold, label, reset, dim, detail, reset)
}

func fail(label, detail string) {
	failed++
	fmt.Printf("  %s✗%s %s%s%s %s%s%s\n", red+bold, reset, bold, label, reset, dim, detail, reset)
}

func section(title string) {
	fmt.Printf("\n%s── %s %s\n", cyan+bold, title, reset)
}

func get(path string) ([]byte, int, error) {
	resp, err := http.Get(apiBase + path)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return body, resp.StatusCode, nil
}

func post(path string, payload any) ([]byte, int, error) {
	b, _ := json.Marshal(payload)
	resp, err := http.Post(apiBase+path, "application/json", bytes.NewReader(b))
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return body, resp.StatusCode, nil
}

// ── Tests ─────────────────────────────────────────────────────

func testHealth() {
	section("1. Health check")
	body, code, err := get("/health")
	if err != nil {
		fail("GET /health", err.Error())
		return
	}
	if code != 200 {
		fail("GET /health", fmt.Sprintf("HTTP %d", code))
		return
	}
	var r struct {
		Status string `json:"status"`
	}
	json.Unmarshal(body, &r)
	if r.Status == "ok" {
		ok("GET /health", "status=ok")
	} else {
		fail("GET /health", fmt.Sprintf("status=%q", r.Status))
	}
}

func testMeta() (stationCount int) {
	section("2. Statistiques base (/api/meta)")
	body, code, err := get("/api/meta")
	if err != nil {
		fail("GET /api/meta", err.Error())
		return 0
	}
	if code != 200 {
		fail("GET /api/meta", fmt.Sprintf("HTTP %d — %s", code, body))
		return 0
	}
	var r struct {
		LastFetch    time.Time `json:"lastFetch"`
		StationCount int       `json:"stationCount"`
		PriceCount   int       `json:"priceCount"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		fail("GET /api/meta", "JSON invalide: "+err.Error())
		return 0
	}
	if r.StationCount == 0 {
		fail("stationCount", "0 — ingestion probablement en échec")
	} else {
		ok("stationCount", fmt.Sprintf("%d stations", r.StationCount))
	}
	if r.PriceCount == 0 {
		fail("priceCount", "0 — aucun prix en base")
	} else {
		ok("priceCount", fmt.Sprintf("%d prix", r.PriceCount))
	}
	ago := time.Since(r.LastFetch)
	if ago > 30*time.Minute {
		fail("lastFetch", fmt.Sprintf("il y a %s — ingestion trop ancienne ?", ago.Round(time.Second)))
	} else {
		ok("lastFetch", fmt.Sprintf("il y a %s", ago.Round(time.Second)))
	}
	return r.StationCount
}

type Station struct {
	StationID  int64   `json:"stationId"`
	Address    string  `json:"address"`
	City       string  `json:"city"`
	PostalCode string  `json:"postalCode"`
	FuelType   string  `json:"fuelType"`
	Price      float64 `json:"price"`
	DistanceKm float64 `json:"distanceKm"`
}

func testNearby(lat, lng float64, fuel string, radius int) []Station {
	section(fmt.Sprintf("3. Stations proches (/api/nearby) — %.4f,%.4f %s r=%dkm", lat, lng, fuel, radius))
	url := fmt.Sprintf("/api/nearby?lat=%f&lng=%f&fuel=%s&radius=%d&limit=5", lat, lng, fuel, radius)
	body, code, err := get(url)
	if err != nil {
		fail("GET /api/nearby", err.Error())
		return nil
	}
	if code != 200 {
		fail("GET /api/nearby", fmt.Sprintf("HTTP %d — %s", code, body))
		return nil
	}
	var stations []Station
	if err := json.Unmarshal(body, &stations); err != nil {
		fail("JSON", "invalide: "+err.Error())
		return nil
	}
	if len(stations) == 0 {
		fail("résultats", fmt.Sprintf("0 stations dans un rayon de %d km — essaie un rayon plus grand", radius))
		return nil
	}
	ok(fmt.Sprintf("%d stations trouvées", len(stations)), "")

	// Vérifier tri croissant
	sorted := true
	for i := 1; i < len(stations); i++ {
		if stations[i].Price < stations[i-1].Price {
			sorted = false
			break
		}
	}
	if sorted {
		ok("tri par prix", "croissant ✓")
	} else {
		fail("tri par prix", "non croissant ✗")
	}

	// Afficher le tableau
	fmt.Printf("\n  %s%-4s %-40s %-10s %s%s\n", dim, "#", "Station", "Distance", "Prix", reset)
	for i, s := range stations {
		addr := s.Address + ", " + s.City
		if len(addr) > 38 {
			addr = addr[:38] + "…"
		}
		marker := " "
		if i == 0 {
			marker = green + "★" + reset
		}
		fmt.Printf("  %s %s%-4d %-40s %-10s %.3f €/L%s\n",
			marker, dim, i+1, addr, fmt.Sprintf("%.1f km", s.DistanceKm), s.Price, reset)
	}

	return stations
}

func testSetup(lat, lng float64, fuel string, radius int) string {
	section(fmt.Sprintf("4. Création de session (/api/setup) — %s", fuel))
	body, code, err := post("/api/setup", map[string]any{
		"fuelType":  fuel,
		"latitude":  lat,
		"longitude": lng,
		"radiusKm":  radius,
	})
	if err != nil {
		fail("POST /api/setup", err.Error())
		return ""
	}
	if code != 200 {
		fail("POST /api/setup", fmt.Sprintf("HTTP %d — %s", code, body))
		return ""
	}
	var r struct {
		SessionID string   `json:"sessionId"`
		Cheapest  *Station `json:"cheapest"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		fail("JSON", err.Error())
		return ""
	}
	if r.SessionID == "" {
		fail("sessionId", "vide")
		return ""
	}
	ok("sessionId", r.SessionID)
	if r.Cheapest == nil {
		fail("cheapest", "null — aucune station dans ce rayon")
	} else {
		ok("cheapest", fmt.Sprintf("%s, %s → %.3f €/L à %.1f km",
			r.Cheapest.Address, r.Cheapest.City, r.Cheapest.Price, r.Cheapest.DistanceKm))
	}
	return r.SessionID
}

func testCheapest(sessionID string, nearbyFirst *Station) {
	section("5. Prix par session (/api/cheapest)")
	if sessionID == "" {
		fail("GET /api/cheapest", "pas de sessionId (étape 4 échouée)")
		return
	}
	body, code, err := get("/api/cheapest?sessionId=" + sessionID)
	if err != nil {
		fail("GET /api/cheapest", err.Error())
		return
	}
	if code != 200 {
		fail("GET /api/cheapest", fmt.Sprintf("HTTP %d — %s", code, body))
		return
	}
	var s Station
	if err := json.Unmarshal(body, &s); err != nil {
		fail("JSON", err.Error())
		return
	}
	ok("GET /api/cheapest", fmt.Sprintf("%s, %s → %.3f €/L", s.Address, s.City, s.Price))

	// Cross-check avec /api/nearby
	if nearbyFirst != nil {
		if s.Price == nearbyFirst.Price && s.StationID == nearbyFirst.StationID {
			ok("cohérence /nearby vs /cheapest", "même station ✓")
		} else {
			fail("cohérence /nearby vs /cheapest",
				fmt.Sprintf("nearby=%.3f€ cheapest=%.3f€ — tri ou rayon différent ?", nearbyFirst.Price, s.Price))
		}
	}
}

func testIngestionSSE() {
	section("6. SSE ingestion (localhost:5001/logs)")
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(ingBase + "/logs")
	if err != nil {
		fail("GET :5001/logs", err.Error()+" — ingestion SSE pas démarrée ?")
		return
	}
	defer resp.Body.Close()
	ct := resp.Header.Get("Content-Type")
	if ct == "text/event-stream" {
		ok("Content-Type", "text/event-stream")
	} else {
		fail("Content-Type", fmt.Sprintf("attendu text/event-stream, reçu %q", ct))
	}
}

// ── Main ──────────────────────────────────────────────────────

func main() {
	lat := flag.Float64("lat", 48.8566, "Latitude (défaut: Paris)")
	lng := flag.Float64("lng", 2.3522, "Longitude (défaut: Paris)")
	fuel := flag.String("fuel", "Gazole", "Type de carburant")
	radius := flag.Int("radius", 10, "Rayon de recherche en km")
	flag.Parse()

	fmt.Printf("\n%s⛽  MawaqitduGazole — Test API%s\n", bold+cyan, reset)
	fmt.Printf("%s   API: %s  |  position: %.4f, %.4f  |  %s  |  r=%dkm%s\n",
		dim, apiBase, *lat, *lng, *fuel, *radius, reset)

	testHealth()
	testMeta()
	nearby := testNearby(*lat, *lng, *fuel, *radius)
	var nearbyFirst *Station
	if len(nearby) > 0 {
		nearbyFirst = &nearby[0]
	}
	sessionID := testSetup(*lat, *lng, *fuel, *radius)
	testCheapest(sessionID, nearbyFirst)
	testIngestionSSE()

	// Résumé
	fmt.Printf("\n%s── Résumé %s\n", cyan+bold, reset)
	total := passed + failed
	if failed == 0 {
		fmt.Printf("  %s✓ Tous les tests passent (%d/%d)%s\n\n", green+bold, passed, total, reset)
		os.Exit(0)
	} else {
		fmt.Printf("  %s✗ %d échec(s) sur %d tests%s\n\n", red+bold, failed, total, reset)
		os.Exit(1)
	}
}
