import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.clarkcosheriff.com/sheriff-sales/"
response = requests.get(url, headers=headers, timeout=10)
html = response.text

# Find where "1505 WILLOW DR" is located
match = re.search(r'1505\s+WILLOW\s+DR', html, re.IGNORECASE)
if match:
    start = max(0, match.start() - 300)
    end = min(len(html), match.end() + 1500)
    print("HTML around 1505 WILLOW DR:")
    print(html[start:end])
else:
    print("Could not find 1505 WILLOW DR in raw HTML.")
