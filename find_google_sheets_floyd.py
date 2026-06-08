import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.fcsdin.com/sheriffsales/"
response = requests.get(url, headers=headers, timeout=10)
html = response.text

# Find any matches for docs.google.com/spreadsheets
matches = re.findall(r'https://docs.google.com/spreadsheets/d/([a-zA-Z0-9-_]+)', html)
print("Found spreadsheet ID matches:")
for m in set(matches):
    print("-", m)

# Let's search for sheet key terms or Ajax config
# Look for sheet-to-wp script variables
script_matches = re.findall(r'<script.*?>([^\0]*?)</script>', html)
print("\nSearching scripts for sheets-to-wp configurations...")
for script in script_matches:
    if "sheets-to-wp" in script or "live-sync" in script or "table" in script:
        # Print lines that look like config
        for line in script.splitlines():
            if "id" in line.lower() or "key" in line.lower() or "sheet" in line.lower() or "url" in line.lower() or "ajax" in line.lower():
                print("Config line:", line.strip())
