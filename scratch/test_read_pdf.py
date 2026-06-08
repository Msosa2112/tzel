import os
import requests

url = "https://www.jeffcomm.org/docs/612-2.PDF"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
}

print("Downloading PDF...")
r = requests.get(url, headers=headers)
print("Status code:", r.status_code)
print("Length of content:", len(r.content))

os.makedirs("scratch", exist_ok=True)
with open("scratch/612-2.pdf", "wb") as f:
    f.write(r.content)
print("Saved to scratch/612-2.pdf")

# Let's check if we can read text using standard python packages (like pypdf or PyPDF2 if installed)
try:
    import pypdf
    reader = pypdf.PdfReader("scratch/612-2.pdf")
    print("pypdf number of pages:", len(reader.pages))
    text = reader.pages[0].extract_text()
    print("pypdf extracted text length:", len(text))
    print("Text preview:")
    print(repr(text[:200]))
except Exception as e:
    print("pypdf error:", e)
