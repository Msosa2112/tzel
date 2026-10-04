import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
# Let's try downloading 612-1.pdf, 612-20.pdf, etc.
# Wait, let's find some files in docs/ that might exist.
# Let's try to query docs/612-1.pdf first or check the HTTP response.
url = "https://www.jeffcomm.org/docs/612-1.pdf"
print(f"Checking {url}...")
try:
    response = requests.get(url, headers=headers, timeout=10)
    print("Status Code:", response.status_code)
    if response.status_code == 200:
        print("Content length:", len(response.content))
        with open("sample.pdf", "wb") as f:
            f.write(response.content)
        print("PDF saved as sample.pdf.")
    else:
        # Let's try to search the list of PDFs in webPush.csv to find an active one.
        print("Failed to download 612-1.pdf.")
except Exception as e:
    print("Failed:", e)
