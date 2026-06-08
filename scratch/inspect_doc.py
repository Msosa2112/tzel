import requests

url = "https://www.jeffcomm.org/docs/handbill/25CI401282.doc"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
}

print("Downloading doc file...")
r = requests.get(url, headers=headers)
print("Downloaded. Length:", len(r.content))

with open("scratch/25CI401282.doc", "wb") as f:
    f.write(r.content)

# Print first 500 bytes as raw bytes representation
print("\nFirst 500 bytes representation:")
print(repr(r.content[:500]))

# Let's search for keywords in the binary content (in lowercase)
content_lower = r.content.lower()
keywords = [b"appraisal", b"claim", b"judgment", b"debt", b"amount", b"vs", b"court", b"commissioner"]
print("\nKeyword search in binary:")
for kw in keywords:
    count = content_lower.count(kw)
    print(f"Keyword '{kw.decode()}' count: {count}")

# Let's extract plain text strings using a simple regex and write to a file
import re
ascii_strings = re.findall(b"[a-zA-Z0-9\\s\\$\\.,\\-]{4,}", r.content)
print(f"\nExtracted ASCII strings count: {len(ascii_strings)}")

out_path = "scratch/doc_strings.txt"
with open(out_path, "w", encoding="utf-8") as out_f:
    for s in ascii_strings:
        s_dec = s.decode("latin1", errors="ignore").strip()
        if s_dec:
            out_f.write(s_dec + "\n")
print(f"Saved extracted strings to {out_path}")

