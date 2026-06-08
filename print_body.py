import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.jeffcomm.org/upcoming-sales.php"
response = requests.get(url, headers=headers, timeout=10)
html = response.text

import re
body_match = re.search(r'<body.*?>(.*?)</body>', html, re.DOTALL)
if body_match:
    body = body_match.group(1)
    print("Body length:", len(body))
    # Print lines that aren't navigation links to keep it short
    for line in body.splitlines():
        line_strip = line.strip()
        if "Home" in line_strip and "Upcoming Sales" in line_strip:
            continue  # skip nav bar
        if line_strip:
            print(line_strip)
else:
    print("No body found.")
