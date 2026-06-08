import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.fcsdin.com/wp-content/plugins/sheets-to-wp-table-live-sync/assets/public/scripts/frontend/frontend.min.js"
response = requests.get(url, headers=headers, timeout=10)
js = response.text

# Find all occurrences of "action"
matches = re.finditer(r'action\s*:\s*["\'](.*?)["\']', js)
print("Found action matches in JS:")
for m in matches:
    print("-", m.group(0))

# Let's search for any jQuery AJAX calls $.ajax or $.post
ajax_calls = re.finditer(r'\.ajax\s*\(', js)
print("\nFound .ajax( matches:")
for m in ajax_calls:
    start = max(0, m.start() - 100)
    end = min(len(js), m.end() + 300)
    print("--- AJAX CALL ---")
    print(js[start:end].replace('\n', ' ').strip())
