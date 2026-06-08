import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.jeffcomm.org/upcoming-sales.php"
print(f"Fetching {url}...")
response = requests.get(url, headers=headers, timeout=10)
html = response.text

print("HTML length:", len(html))
print("Finding headers or titles:")
titles = re.findall(r'<h[1-6].*?>(.*?)</h[1-6]>', html)
for t in titles:
    print("- Title:", t)

# Look for table structures
tables = re.findall(r'<table.*?>', html)
print(f"Found {len(tables)} tables.")

# Print a snippet of where tables start
table_starts = [m.start() for m in re.finditer(r'<table', html)]
for idx, start in enumerate(table_starts):
    print(f"\n--- Table {idx+1} Snippet (starts at char {start}) ---")
    print(html[start:start+1000])
