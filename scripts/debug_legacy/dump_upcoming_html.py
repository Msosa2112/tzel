import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.jeffcomm.org/upcoming-sales.php"
response = requests.get(url, headers=headers, timeout=10)
html = response.text

# Find the main body content, usually inside <main> or <div class="content"> or similar
# Let's just find all <a> links on the page and all texts inside <div> tags with class or id
# Let's print out all links inside the page
print("All links on upcoming-sales.php:")
links = re.findall(r'<a\s+(?:[^>]*?\s+)?href=["\'](.*?)["\']>(.*?)</a>', html)
for l, text in links:
    text_clean = re.sub('<[^<]+?>', '', text).strip()
    print(f"- Link: {l} | Text: {text_clean}")

# Let's find some key paragraphs
paragraphs = re.findall(r'<p>(.*?)</p>', html, re.DOTALL)
print("\nParagraphs on page:")
for p in paragraphs:
    p_clean = re.sub(r'\s+', ' ', re.sub('<[^<]+?>', '', p)).strip()
    if p_clean:
        print("-", p_clean)
