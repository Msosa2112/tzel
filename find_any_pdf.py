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

found_count = 0
for idx, row in enumerate(reader):
    if len(row) < 9:
        continue
    case_num = row[0]
    sale_date = row[4]
    docket = row[5]
    address = row[6]
    
    last_slash = sale_date.rfind('/')
    if last_slash == -1:
        continue
    new_date = sale_date[0:last_slash].replace('/', '')
    
    pdf_name_1 = f"{new_date}-{docket}.pdf"
    pdf_name_2 = f"{new_date}-{docket}.PDF"
    
    for item in [pdf_name_1, pdf_name_2]:
        item_url = f"https://www.jeffcomm.org/docs/{item}"
        try:
            resp = requests.head(item_url, headers=headers, timeout=2)
            if resp.status_code == 200:
                print(f"[PDF FOUND] {item_url} exists! Case: {case_num}, Date: {sale_date}, Address: {address}")
                found_count += 1
                if found_count >= 5:
                    break
        except Exception as e:
            pass
    if found_count >= 5:
        break

if found_count == 0:
    print("Checked all rows and found NO active PDFs at all. They might be using a different directory structure or naming scheme for appraisals.")
