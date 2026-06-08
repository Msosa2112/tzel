import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
}

for i in range(1, 10):
    url = f"https://www.jeffcomm.org/docs/612-{i}.PDF"
    r = requests.head(url, headers=headers)
    print(f"612-{i}.PDF status: {r.status_code}, size: {r.headers.get('Content-Length')}")
