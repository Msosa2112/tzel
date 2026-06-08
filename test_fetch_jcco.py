import requests

print("Fetching jeffcomm.org homepage...")
try:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    response = requests.get("https://www.jeffcomm.org/", headers=headers, timeout=10)
    print("Status Code:", response.status_code)
    print("HTML length:", len(response.text))
    print("Snippet:")
    print(response.text[:1500])
except Exception as e:
    print("Fetch failed:", e)
