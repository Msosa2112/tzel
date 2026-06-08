import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
urls = [
    "https://www.jeffcomm.org/assets/js/upcoming-sales.js",
    "https://www.jeffcomm.org/upcoming-sales.js"
]

for url in urls:
    print(f"Fetching {url}...")
    try:
        response = requests.get(url, headers=headers, timeout=10)
        print("Status Code:", response.status_code)
        if response.status_code == 200:
            print("Content length:", len(response.text))
            print("Snippet:")
            print(response.text[:2000])
    except Exception as e:
        print("Failed:", e)
