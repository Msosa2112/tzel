import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.fcsdin.com/sheriffsales/"
response = requests.get(url, headers=headers, timeout=10)
html = response.text

# Find all div tags that might contain the table
divs = re.findall(r'<div\s+[^>]*?class=["\'][^"\']*?(?:sheet|table|live-sync)[^"\']*?["\'][^>]*?>', html)
print("Found matching div tags:")
for d in divs:
    print("-", d)

# Let's print the entire element or contents of elements that contain sheets-to-wp
# Search for sheets-to-wp-table elements
elements = re.findall(r'<[a-zA-Z0-9-]+\s+[^>]*?sheets-to-wp-table[^>]*?>', html)
print("\nFound sheets-to-wp-table elements:")
for el in elements:
    print("-", el)
