import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.clarkcosheriff.com/sheriff-sales/"
print(f"Fetching {url}...")
try:
    response = requests.get(url, headers=headers, timeout=10)
    html = response.text
    
    # Let's search for any PDF or download links
    all_links = re.findall(r'href=["\'](.*?)["\']', html)
    print("Found links:")
    for l in set(all_links):
        if "pdf" in l.lower() or "drive.google" in l.lower() or "dropbox" in l.lower() or "files" in l.lower() or "download" in l.lower():
            print("- Link:", l)
            
    # Print paragraphs that have numbers or addresses
    # Let's clean tags and find text lines
    clean_text = re.sub('<[^<]+?>', '\n', html)
    lines = clean_text.splitlines()
    print("\nInteresting text lines on Clark County page:")
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # Search for address indicators
        if any(w in line.upper() for w in ["STREET", "AVENUE", "ROAD", "DRIVE", "COURT", "LANE", "ROUTE", "HWY", "HIGHWAY", "INDIANA", "JEFFERSONVILLE", "CLARK", "SHERIFF SALE", "AUCTION"]):
            if len(line) > 10 and len(line) < 150:
                print("-", line)
except Exception as e:
    print("Failed:", e)
