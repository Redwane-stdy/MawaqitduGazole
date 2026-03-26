// Package parser handles the French government open-data XML format.
// Source: https://data.gouv.fr — Prix des carburants en France (flux instantané v2)
// The XML encodes latitude/longitude as integers × 100 000.
package parser

import (
	"encoding/xml"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// ---- XML structures --------------------------------------------------------

type PDVList struct {
	XMLName  xml.Name  `xml:"pdv_liste"`
	Stations []Station `xml:"pdv"`
}

type Station struct {
	ID        string  `xml:"id,attr"`
	Latitude  string  `xml:"latitude,attr"`
	Longitude string  `xml:"longitude,attr"`
	CP        string  `xml:"cp,attr"`
	Pop       string  `xml:"pop,attr"`
	Address   string  `xml:"adresse"`
	City      string  `xml:"ville"`
	Prices    []Price `xml:"prix"`
}

type Price struct {
	Name  string `xml:"nom,attr"`
	ID    string `xml:"id,attr"`
	Maj   string `xml:"maj,attr"`
	Value string `xml:"valeur,attr"`
}

// ---- Parsed output ---------------------------------------------------------

type ParsedStation struct {
	ID        int64
	Latitude  float64
	Longitude float64
	PostCode  string
	Address   string
	City      string
	Prices    []ParsedPrice
}

type ParsedPrice struct {
	FuelType string
	Price    float64
}

// FuelTypeMap normalises the French government fuel names to our internal names.
var FuelTypeMap = map[string]string{
	"Gazole": "Gazole",
	"SP95":   "SP95",
	"SP98":   "SP98",
	"E10":    "E10",
	"E85":    "E85",
	"GPLc":   "GPLc",
}

// iso8859Reader wraps an ISO-8859-1 / Latin-1 byte stream and re-encodes it
// as UTF-8 on the fly (Latin-1 codepoints map 1:1 to Unicode).
func iso8859Reader(charset string, input io.Reader) (io.Reader, error) {
	if !strings.EqualFold(charset, "iso-8859-1") && !strings.EqualFold(charset, "latin-1") {
		return nil, fmt.Errorf("unsupported charset: %s", charset)
	}
	raw, err := io.ReadAll(input)
	if err != nil {
		return nil, err
	}
	runes := make([]rune, len(raw))
	for i, b := range raw {
		runes[i] = rune(b)
	}
	return strings.NewReader(string(runes)), nil
}

// Parse decodes the XML stream returned by the government API.
func Parse(r io.Reader) ([]ParsedStation, error) {
	var list PDVList
	dec := xml.NewDecoder(r)
	dec.CharsetReader = iso8859Reader
	if err := dec.Decode(&list); err != nil {
		return nil, err
	}

	stations := make([]ParsedStation, 0, len(list.Stations))
	for _, s := range list.Stations {
		id, err := strconv.ParseInt(s.ID, 10, 64)
		if err != nil {
			continue
		}

		// Coordinates are stored as integer × 100 000
		latRaw, err1 := strconv.ParseFloat(s.Latitude, 64)
		lngRaw, err2 := strconv.ParseFloat(s.Longitude, 64)
		if err1 != nil || err2 != nil {
			continue
		}

		lat := latRaw / 100_000
		lng := lngRaw / 100_000

		// Sanity-check: France bounding box
		if lat < 41 || lat > 52 || lng < -6 || lng > 10 {
			continue
		}

		ps := ParsedStation{
			ID:        id,
			Latitude:  lat,
			Longitude: lng,
			PostCode:  s.CP,
			Address:   strings.TrimSpace(s.Address),
			City:      strings.TrimSpace(s.City),
		}

		for _, p := range s.Prices {
			if p.Value == "" {
				continue
			}
			price, err := strconv.ParseFloat(p.Value, 64)
			if err != nil || price <= 0 {
				continue
			}
			fuelType, ok := FuelTypeMap[p.Name]
			if !ok {
				continue
			}
			ps.Prices = append(ps.Prices, ParsedPrice{
				FuelType: fuelType,
				Price:    price,
			})
		}

		if len(ps.Prices) > 0 {
			stations = append(stations, ps)
		}
	}
	return stations, nil
}
