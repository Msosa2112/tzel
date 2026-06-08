import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
}

cases = ["25CI400585", "25CI401282", "24CI007005", "23CI400604"]
for case in cases:
    url = f"https://www.jeffcomm.org/docs/handbill/{case}.doc"
    r = requests.head(url, headers=headers)
    print(f"{case}.doc status: {r.status_code}, size: {r.headers.get('Content-Length')}")
