import requests
import json

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.fcsdin.com/sheriffsales/"
}

url = "https://www.fcsdin.com/wp-admin/admin-ajax.php"
payload = {
    "action": "gswpts_sheet_fetch",
    "id": "5",
    "nonce": "7a6095ba72"
}

print("Fetching Floyd County Sheriff Sales data...")
try:
    resp = requests.post(url, headers=headers, data=payload, timeout=10)
    print("Status:", resp.status_code)
    print("Content length:", len(resp.text))
    # Parse json response
    data = resp.json()
    print("JSON keys:", data.keys())
    if data.get("success"):
        # Let's save a snippet or print structure of data
        print("Success! Table data received.")
        table_data = data.get("data", {})
        print("Table config keys:", table_data.keys())
        # The actual HTML output is in table_data['output']
        html_out = table_data.get("output", "")
        print("HTML output length:", len(html_out))
        print("First 1000 chars of HTML output:")
        print(html_out[:1000])
        # Save HTML to file for detailed analysis
        with open("floyd_table.html", "w", encoding="utf-8") as f:
            f.write(html_out)
        print("Saved HTML table to floyd_table.html.")
    else:
        print("Failed to fetch sheet data:", data)
except Exception as e:
    print("Failed:", e)
