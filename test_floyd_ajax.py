import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.fcsdin.com/sheriffsales/"
}

url = "https://www.fcsdin.com/wp-admin/admin-ajax.php"

# Let's test a few common actions for Sheets to WP Table plugin
actions = [
    "gswpts_table_data",
    "gswpts_get_table_data",
    "swptls_get_table_data",
    "gswpts_table_data_fetch"
]

for action in actions:
    print(f"Testing action: {action}...")
    payload = {
        "action": action,
        "id": "5",
        "nonce": "7a6095ba72"
    }
    try:
        resp = requests.post(url, headers=headers, data=payload, timeout=8)
        print("  Status Code:", resp.status_code)
        print("  Content length:", len(resp.text))
        if resp.status_code == 200 and len(resp.text) > 50 and "0" != resp.text.strip():
            print("  [SUCCESS] Found correct action!")
            print("  Snippet:", resp.text[:1000])
            break
    except Exception as e:
        print("  Failed:", e)
