// Package fetcher downloads the government open-data file.
// The endpoint returns a ZIP archive containing a single XML file.
package fetcher

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

const (
	// Official French government open data — no API key required.
	// Data is updated every ~10 minutes by the government.
	dataURL = "https://donnees.roulez-eco.fr/opendata/instantane"

	timeout = 60 * time.Second
)

var client = &http.Client{Timeout: timeout}

// FetchXML downloads the ZIP archive and returns the raw XML bytes inside.
func FetchXML() ([]byte, error) {
	log.Printf("[fetcher] downloading fuel prices from %s", dataURL)

	resp, err := client.Get(dataURL)
	if err != nil {
		return nil, fmt.Errorf("http get: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	// The response is a ZIP — extract the first (and only) XML entry.
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		// Not a ZIP (maybe raw XML?) — try to use directly.
		log.Printf("[fetcher] not a zip, using raw response (%d bytes)", len(body))
		return body, nil
	}

	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			continue
		}
		defer rc.Close()
		xml, err := io.ReadAll(rc)
		if err != nil {
			return nil, fmt.Errorf("read zip entry: %w", err)
		}
		log.Printf("[fetcher] extracted %s (%d bytes)", f.Name, len(xml))
		return xml, nil
	}
	return nil, fmt.Errorf("no file found in zip archive")
}
