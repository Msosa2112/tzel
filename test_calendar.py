import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.jeffcomm.org/sale-Calendar.php"
print(f"Fetching {url}...")
response = requests.get(url, headers=headers, timeout=10)
html = response.text

print("HTML length:", len(html))
# Find links matching calendar or dates
links = re.findall(r'href=["\'](.*?)["\']', html)
print("Found links matching criteria:")
for l in links:
    if "csv" in l.lower() or "pdf" in l.lower() or "sales" in l.lower() or "js" in l.lower():
        print("-", l)
