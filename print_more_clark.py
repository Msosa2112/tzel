import requests
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.clarkcosheriff.com/sheriff-sales/"
response = requests.get(url, headers=headers, timeout=10)
html = response.text

clean_text = re.sub('<[^<]+?>', '\n', html)
lines = clean_text.splitlines()

start_idx = -1
for i, line in enumerate(lines):
    if "SHERIFF SALES 2026" in line:
        start_idx = i
        break

if start_idx != -1:
    print("Dumping lines:")
    non_empty_lines = []
    for line in lines[start_idx:start_idx+600]:
        line = line.strip()
        if line:
            non_empty_lines.append(line)
    
    # Print the first 250 non-empty lines
    for idx, l in enumerate(non_empty_lines[:200]):
        print(f"{idx+1}: {l}")
else:
    print("Could not find start point.")
