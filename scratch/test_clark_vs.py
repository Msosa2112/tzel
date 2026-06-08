import requests
import re

url = "https://www.clarkcosheriff.com/sheriff-sales/"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
try:
    r = requests.get(url, headers=headers)
    html = r.text
    # Remover scripts y estilos
    html_clean = re.sub(r'<script.*?</script>', '', html, flags=re.DOTALL)
    html_clean = re.sub(r'<style.*?</style>', '', html_clean, flags=re.DOTALL)
    # Extraer texto visible
    text_lines = re.sub(r'<[^>]+>', '\n', html_clean)
    for line in text_lines.splitlines():
        line = line.strip()
        if not line:
            continue
        if 'vs' in line.lower():
            print("Línea:", line)
except Exception as e:
    print("Error:", e)
