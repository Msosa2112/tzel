package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/gocolly/colly/v2"
)

// Lead represents the structured data scraped from static edicts/tables.
type Lead struct {
	Address     string `json:"address"`
	ParcelID    string `json:"parcel_id"`
	Defendant   string `json:"defendant"`
	AuctionDate string `json:"auction_date"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage: %s <url_or_filepath>\n", os.Args[0])
		os.Exit(1)
	}

	target := os.Args[1]

	// 1. Initialize Collector with disk cache
	c := colly.NewCollector(
		colly.CacheDir("./.colly_cache"),
	)

	// 2. Set strict rate limits
	_ = c.Limit(&colly.LimitRule{
		DomainGlob:  "*",
		Parallelism: 4,
		Delay:       1500 * time.Millisecond,
	})

	// Heuristics patterns
	dateReg := regexp.MustCompile(`\b\d{1,2}/\d{1,2}/\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b`)
	parcelReg := regexp.MustCompile(`\b\d{2}-\d{2}-\d{2}-\d{3}-\d{3}\b|\b\d{10,}\b`)
	streetReg := regexp.MustCompile(`\b\d+\s+[A-Za-z0-9\s#]+?\s+(?:St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Way|Blvd|Boulevard|Cir|Circle|Ct|Court|Hwy|Highway|Dr|Drive|Trl|Trail)\b`)

	var currentDateHeader = "Unknown Date"

	// 3. Register HTML parsing rules
	c.OnHTML("table", func(tableElement *colly.HTMLElement) {
		// Iterate through table rows
		tableElement.ForEach("tr", func(_ int, trElement *colly.HTMLElement) {
			cells := []string{}
			trElement.ForEach("td", func(_ int, tdElement *colly.HTMLElement) {
				cells = append(cells, strings.TrimSpace(tdElement.Text))
			})

			// Filter out empty cells
			nonEmpty := []string{}
			for _, val := range cells {
				if val != "" {
					nonEmpty = append(nonEmpty, val)
				}
			}

			// If single cell contains date indications, update date header
			if len(nonEmpty) == 1 {
				val := nonEmpty[0]
				if dateReg.MatchString(val) || strings.Contains(strings.ToLower(val), "sale") || strings.Contains(strings.ToLower(val), "auction") {
					currentDateHeader = val
				}
				return
			}

			// If row has multiple columns, process as property row
			if len(cells) >= 3 {
				lead := Lead{
					AuctionDate: currentDateHeader,
				}

				// Look for address, parcel, defendant
				for _, cell := range cells {
					cleanCell := strings.TrimSpace(cell)
					if cleanCell == "" {
						continue
					}

					// A. Check if it matches street pattern
					if streetReg.MatchString(cleanCell) && lead.Address == "" {
						// Append city/state/zip if present in adjacent cells
						lead.Address = cleanCell
						continue
					}

					// B. Check if it matches parcel ID pattern
					if parcelReg.MatchString(cleanCell) && lead.ParcelID == "" {
						lead.ParcelID = cleanCell
						continue
					}

					// C. Check if it contains date (override default date header if cell has one)
					if dateReg.MatchString(cleanCell) {
						lead.AuctionDate = dateReg.FindString(cleanCell)
						continue
					}
				}

				// If we found an address, try to map defendant/debtor from remaining cells
				if lead.Address != "" {
					for _, cell := range cells {
						cleanCell := strings.TrimSpace(cell)
						if cleanCell == "" || cleanCell == lead.Address || cleanCell == lead.ParcelID || dateReg.MatchString(cleanCell) {
							continue
						}
						// If the cell contains vs or versus, or plaintiff name, try to extract defendant
						lower := strings.ToLower(cleanCell)
						if strings.Contains(lower, " vs ") || strings.Contains(lower, " vs. ") || strings.Contains(lower, " versus ") {
							parts := strings.Split(cleanCell, "v.")
							if len(parts) < 2 {
								parts = strings.Split(lower, "vs")
							}
							if len(parts) >= 2 {
								lead.Defendant = strings.TrimSpace(parts[1])
								break
							}
						}
						// Fallback: use first text cell that is not address or parcel
						if lead.Defendant == "" && len(cleanCell) > 3 && !strings.Contains(lower, "active") && !strings.Contains(lower, "status") {
							lead.Defendant = cleanCell
						}
					}

					if lead.Defendant == "" {
						lead.Defendant = "Unknown Defendant"
					}

					// Clean up any newlines or extra spaces
					lead.Address = strings.ReplaceAll(lead.Address, "\n", " ")
					lead.Defendant = strings.ReplaceAll(lead.Defendant, "\n", " ")

					// Print structured JSON lead to stdout
					data, err := json.Marshal(lead)
					if err == nil {
						fmt.Println(string(data))
					}
				}
			}
		})
	})

	// Start scraping
	err := c.Visit(target)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error visiting target: %s\n", err.Error())
		os.Exit(1)
	}
}
