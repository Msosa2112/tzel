import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

urls = [
    "https://www.fcsdin.com/sheriff-sales/",
    "https://www.fcsdin.com/sheriff-sale/",
    "https://www.fcsdin.com/public-services/sheriff-sales/",
    "https://fcsdin.net/sheriff-sales/",
    "https://floydcountysheriff.com/sheriff-sales/"
]

for url in urls:
    print(f"Testing {url}...")
    try:
        resp = requests.get(url, headers=headers, timeout=5)
        print("  Status Code:", resp.status_code)
        if resp.status_code == 200 and "Page not found" not in resp.text:
            print("  [SUCCESS] Found correct URL! HTML length:", len(resp.text))
            print("  Snippet:")
            print(resp.text[:500])
            break
    except Exception as e:
        print("  Failed:", e)
