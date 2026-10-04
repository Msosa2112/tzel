import re

with open("E:/DT.t/tzel/floyd_table.html", "r", encoding="utf-8") as f:
    html = f.read()

tbody_match = re.search(r'<tbody>(.*?)</tbody>', html, re.DOTALL)
if tbody_match:
    tbody = tbody_match.group(1)
    rows = re.findall(r'<tr.*?>(.*?)</tr>', tbody, re.DOTALL)
    
    current_date = "Unknown Date"
    
    for idx, r in enumerate(rows):
        cells = re.findall(r'<td.*?>(.*?)</td>', r, re.DOTALL)
        clean_cells = [re.sub('<[^<]+?>', '', c).strip() for c in cells]
        
        # If all cells except address are empty, and address is a date or month name:
        non_empty = [c for c in clean_cells if c]
        if len(non_empty) == 1:
            val = non_empty[0]
            # Check if this single value contains a year or month
            if any(m in val.lower() for m in ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "sales"]):
                current_date = val
                print(f"\n--- DATE HEADER DETECTED: {current_date} ---")
        elif len(non_empty) >= 3:
            # This is a property row
            # Columns: ['', Address, City, State, Zip, Status]
            address = clean_cells[1]
            city = clean_cells[2]
            state = clean_cells[3]
            zip_code = clean_cells[4]
            status = clean_cells[5] if len(clean_cells) > 5 else ""
            
            full_address = f"{address}, {city}, {state} {zip_code}"
            print(f"  Lead: {full_address} | Status: {status} | Sale Date: {current_date}")
