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
print("All lines containing months or years:")
for line in lines:
    line = line.strip()
    if not line:
        continue
    if any(m in line.lower() for m in ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "2026", "2027"]):
        print("-", line)
