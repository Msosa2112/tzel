import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.clarkcosheriff.com/sheriff-sales/"
response = requests.get(url, headers=headers, timeout=10)
html = response.text

# Find all href links on the page
links = re.findall(r'<a\s+(?:[^>]*?\s+)?href=["\'](.*?)["\']>(.*?)</a>', html)
print("All links on the page:")
for l, text in links:
    text_clean = re.sub('<[^<]+?>', '', text).strip()
    if text_clean or "http" in l:
        print(f"- Href: {l} | Text: {text_clean}")
