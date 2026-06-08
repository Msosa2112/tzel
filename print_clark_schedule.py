import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.clarkcosheriff.com/sheriff-sales/"
response = requests.get(url, headers=headers, timeout=10)
html = response.text

clean_text = re.sub('<[^<]+?>', '\n', html)
lines = clean_text.splitlines()

# We only print the lines around the listings area
# Let's find index of "SHERIFF SALES 2026"
start_idx = -1
for i, line in enumerate(lines):
    if "SHERIFF SALES 2026" in line:
        start_idx = i
        break

if start_idx != -1:
    print("Listing lines starting from SHERIFF SALES 2026:")
    for line in lines[start_idx:start_idx+100]:
        line = line.strip()
        if line:
            print("-", line)
else:
    print("Could not find SHERIFF SALES 2026")
