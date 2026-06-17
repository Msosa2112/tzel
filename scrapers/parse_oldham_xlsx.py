import sys
import os
import json
import re
import datetime
import openpyxl

def parse_excel(filepath):
    if not os.path.exists(filepath):
        print(json.dumps({"error": f"File not found: {filepath}"}))
        return

    try:
        wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
        sheet = wb.active # Use the active sheet
        
        properties = []
        current_date_str = None
        
        # Case number pattern: e.g. "25-CI-00210"
        case_pattern = re.compile(r'^\d{2}-CI-\d{3,6}$', re.IGNORECASE)
        
        for row in sheet.iter_rows(values_only=True):
            if not row or not any(row):
                continue
            
            # Check for date header in the first cell
            first_val = row[0]
            if first_val is not None:
                # 1. First cell is datetime object
                if isinstance(first_val, (datetime.datetime, datetime.date)):
                    current_date_str = first_val.strftime("%Y-%m-%d")
                    continue
                # 2. First cell is string containing date
                first_val_str = str(first_val).strip()
                date_match = re.match(r'^(\d{4}-\d{2}-\d{2})', first_val_str)
                if date_match:
                    current_date_str = date_match.group(1)
                    continue
                
                # Check if this is a case row
                if case_pattern.match(first_val_str):
                    case_number = first_val_str
                    parties = str(row[1] or "").strip()
                    county_time = str(row[2] or "").strip()
                    address = str(row[3] or "").strip()
                    appraisal_val = row[4]
                    status = str(row[6] or "").strip()
                    
                    # Determine County
                    county = "Unknown"
                    county_time_lower = county_time.lower()
                    if "oldham" in county_time_lower:
                        county = "Oldham"
                    elif "henry" in county_time_lower:
                        county = "Henry"
                    elif "trimble" in county_time_lower:
                        county = "Trimble"
                    
                    # Split plaintiff and defendant
                    plaintiff = "Unknown"
                    defendant = "Unknown"
                    if " v " in parties:
                        parts = parties.split(" v ")
                        plaintiff = parts[0].strip()
                        defendant = parts[1].strip()
                    elif " vs. " in parties.lower():
                        # Case-insensitive split
                        parts = re.split(r'\s+vs\.?\s+', parties, flags=re.IGNORECASE)
                        if len(parts) >= 2:
                            plaintiff = parts[0].strip()
                            defendant = parts[1].strip()
                    
                    # Clean appraisal value
                    appraisal_price = None
                    if appraisal_val is not None:
                        try:
                            appraisal_price = float(str(appraisal_val).replace("$", "").replace(",", "").strip())
                        except ValueError:
                            pass
                            
                    # Build property item
                    prop = {
                        "case_number": case_number,
                        "plaintiff": plaintiff,
                        "defendant": defendant,
                        "county": county,
                        "address": address,
                        "appraisal_value": appraisal_price,
                        "auction_date": current_date_str or "Pending",
                        "status": status
                    }
                    properties.append(prop)
                    
        print(json.dumps(properties, indent=2))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing Excel file path argument"}))
    else:
        parse_excel(sys.argv[1])
