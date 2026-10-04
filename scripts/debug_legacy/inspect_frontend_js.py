import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.fcsdin.com/wp-content/plugins/sheets-to-wp-table-live-sync/assets/public/scripts/frontend/frontend.min.js"
print(f"Fetching {url}...")
try:
    resp = requests.get(url, headers=headers, timeout=10)
    print("Status:", resp.status_code)
    js = resp.text
    # Print lines containing ajax or post or action or data
    import re
    # Since it is minified, let's just search for substrings like "action:" or "admin-ajax"
    print("Substrings found:")
    for m in re.finditer(r'action|table_id|nonce|gswpts', js):
        start = max(0, m.start() - 50)
        end = min(len(js), m.end() + 150)
        print("-", js[start:end].replace('\n', ' ').strip())
        print("..." * 10)
except Exception as e:
    print("Failed:", e)
