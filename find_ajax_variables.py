import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.fcsdin.com/sheriffsales/"
response = requests.get(url, headers=headers, timeout=10)
html = response.text

# Let's search for scripts containing front_end_data
scripts = re.findall(r'<script.*?>([^\0]*?)</script>', html)
print("Found scripts containing front_end_data:")
for script in scripts:
    if "front_end_data" in script or "gswpts_table_data" in script or "gswpts_table" in script:
        print(script.strip())
        print("-" * 50)
