import requests
import csv

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
url = "https://www.jeffcomm.org/docs/webPush.csv"
response = requests.get(url, headers=headers, timeout=10)
text = response.text

reader = csv.reader(text.splitlines())
header = next(reader)
print("CSV Header:", header)

active_listings = []
for row in reader:
    if len(row) < 9:
        continue
    case_num = row[0]
    sale_date = row[4]
    docket = row[5]
    address = row[6]
    status = row[8].strip().upper()
    
    if "WITHDRAWN" not in status:
        active_listings.append({
            "case": case_num,
            "date": sale_date,
            "docket": docket,
            "address": address,
            "status": status
        })

print(f"Found {len(active_listings)} active listings.")
for x in active_listings[:10]:
    # Formulate PDF URL
    date_parts = x["date"].split("/")
    if len(date_parts) == 3:
        new_date_str = f"{date_parts[0]}{date_parts[1]}"
        pdf_url = f"https://www.jeffcomm.org/docs/{new_date_str}-{x['docket']}.pdf"
        print(f"- Case: {x['case']} | Address: {x['address']} | Date: {x['date']} | Status: {x['status']} | PDF URL: {pdf_url}")
        # Let's try to check if PDF exists
        try:
            head_resp = requests.head(pdf_url, headers=headers, timeout=5)
            print("  Status:", head_resp.status_code)
            if head_resp.status_code == 200:
                print("  [FOUND] PDF exists!")
        except Exception as e:
            print("  Check failed:", e)
