import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.fcsdin.com/sheriffsales/"
print(f"Fetching {url}...")
try:
    resp = requests.get(url, headers=headers, timeout=10)
    print("Status:", resp.status_code)
    html = resp.text
    print("HTML length:", len(html))
    
    # Check for sheets to wp table or standard tables
    import re
    tables = re.findall(r'<table.*?>', html)
    print(f"Found {len(tables)} tables.")
    
    # Let's search for table body snippet or iframe or sheets
    if "sheets" in html.lower() or "google" in html.lower():
        print("Page contains google sheets references.")
        
    # Print a snippet of HTML around where table starts
    for m in re.finditer(r'<table', html):
        start = m.start()
        print("\n--- Table Snippet ---")
        print(html[start:start+1200])
        break
        
except Exception as e:
    print("Failed:", e)
