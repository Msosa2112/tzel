from bs4 import BeautifulSoup

with open("floyd_table.html", "r", encoding="utf-8") as f:
    html = f.read()

soup = BeautifulSoup(html, "html.parser")
rows = soup.find_all("tr")
print(f"Total rows found: {len(rows)}")

for i, row in enumerate(rows[:25]):
    cells = [td.get_text().strip() for td in row.find_all("td")]
    if cells:
        print(f"Row {i}: {cells}")
