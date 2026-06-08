import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
response = requests.get("https://www.jeffcomm.org/", headers=headers, timeout=10)
html = response.text

# Find all href links
links = re.findall(r'href=["\'](.*?)["\']', html)
print("Found links matching criteria:")
for l in links:
    if "sale" in l.lower() or "upcoming" in l.lower() or "calendar" in l.lower() or "pdf" in l.lower():
        print("-", l)
