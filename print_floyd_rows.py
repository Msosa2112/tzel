import re

with open("E:/DT.t/tzel/floyd_table.html", "r", encoding="utf-8") as f:
    html = f.read()

# Find rows inside <tbody>
tbody_match = re.search(r'<tbody>(.*?)</tbody>', html, re.DOTALL)
if tbody_match:
    tbody = tbody_match.group(1)
    # Find all tr tags
    rows = re.findall(r'<tr.*?>(.*?)</tr>', tbody, re.DOTALL)
    print(f"Total rows in Floyd County Sheriff Sales: {len(rows)}")
    for idx, r in enumerate(rows[:15]):
        # Extract td contents
        cells = re.findall(r'<td.*?>(.*?)</td>', r, re.DOTALL)
        # Clean tags from cell content
        clean_cells = []
        for c in cells:
            clean = re.sub('<[^<]+?>', '', c).strip()
            clean_cells.append(clean)
        print(f"Row {idx+1}: {clean_cells}")
else:
    print("No tbody found.")
