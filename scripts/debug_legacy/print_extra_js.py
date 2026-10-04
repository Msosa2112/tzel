import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.fcsdin.com/sheriffsales/"
response = requests.get(url, headers=headers, timeout=10)
html = response.text

# Find all script tags
matches = re.finditer(r'<script\s+[^>]*?id=["\']GSWPTS-frontend-js-js-extra["\'][^>]*?>(.*?)</script>', html, re.DOTALL)
print("Found scripts matching id:")
for m in matches:
    print(m.group(1).strip())
    print("-" * 50)
    
# Let's search for any script containing window.front_end_data or var front_end_data
matches_vars = re.finditer(r'front_end_data\s*=\s*(.*?);', html, re.DOTALL)
print("\nFound matches for front_end_data assignment:")
for m in matches_vars:
    print(m.group(0).strip())
