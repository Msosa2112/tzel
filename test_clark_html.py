import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.clarkcosheriff.com/sheriff-sales/"
print(f"Fetching {url}...")
try:
    response = requests.get(url, headers=headers, timeout=12)
    html = response.text
    print("HTML length:", len(html))
    
    # Check for PDFs or documents linked
    links = re.findall(r'href=["\'](.*?\.(?:pdf|docx|xlsx|csv))["\']', html, re.IGNORECASE)
    print("Found document links:")
    for l in set(links):
        print("-", l)
        
    # Check for any tables on the page
    tables = re.findall(r'<table.*?>', html)
    print(f"Found {len(tables)} tables.")
    
    # Check for text patterns that look like addresses or listings
    # e.g., numbers followed by uppercase words representing street names
    matches = re.findall(r'\b\d+\s+[A-Z0-9\s]+(?:AVE|ST|RD|BLVD|LN|PL|WAY|DR|CT)\b', html)
    print(f"Found {len(matches)} potential address matches:")
    for m in set(matches[:15]):
        print("-", m)
        
except Exception as e:
    print("Failed:", e)
