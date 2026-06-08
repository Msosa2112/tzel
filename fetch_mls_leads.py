import os
import requests
from dotenv import load_dotenv

# Load variables from .env
load_dotenv()

class TursoClient:
    def __init__(self):
        url = os.getenv("TURSO_DATABASE_URL")
        if not url:
            raise ValueError("TURSO_DATABASE_URL is not set in .env")
        if url.startswith("libsql://"):
            url = url.replace("libsql://", "https://")
        self.url = f"{url.rstrip('/')}/v2/pipeline"
        self.token = os.getenv("TURSO_AUTH_TOKEN")
        if not self.token:
            raise ValueError("TURSO_AUTH_TOKEN is not set in .env")
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }

    def execute(self, sql, args=[]):
        formatted_args = []
        for arg in args:
            if isinstance(arg, int):
                formatted_args.append({"type": "integer", "value": arg})
            elif isinstance(arg, float):
                formatted_args.append({"type": "float", "value": arg})
            elif arg is None:
                formatted_args.append({"type": "null"})
            else:
                formatted_args.append({"type": "text", "value": str(arg)})

        payload = {
            "requests": [
                {
                    "type": "execute",
                    "stmt": {
                        "sql": sql,
                        "args": formatted_args
                    }
                },
                {
                    "type": "close"
                }
            ]
        }
        
        response = requests.post(self.url, headers=self.headers, json=payload, timeout=15)
        if response.status_code == 200:
            res_json = response.json()
            results = res_json.get("results", [])
            if not results or len(results) == 0:
                raise Exception("Empty response from database")
            
            first_result = results[0]
            if first_result.get("type") == "error":
                error_msg = first_result.get("error", {}).get("message", "Unknown database error")
                raise Exception(error_msg)
            
            return first_result.get("response", {}).get("result", {})
        else:
            raise Exception(f"HTTP Error {response.status_code}: {response.text}")

def setup_database(db):
    print("Setting up Turso database table...")
    db.execute("""
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_key TEXT UNIQUE,
            listing_id TEXT,
            parcel_id TEXT,
            address TEXT,
            close_price REAL,
            list_price REAL,
            close_date TEXT,
            county TEXT,
            remarks TEXT,
            owner_name TEXT,
            surplus_amount REAL,
            status TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print("[DATABASE] Table 'properties' is ready.")

def fetch_and_process_leads():
    # 1. Initialize DB Client
    db = TursoClient()
    setup_database(db)
    
    # 2. Initialize MLS Client
    spark_token = os.getenv("SPARK_ACCESS_TOKEN_1")
    if not spark_token:
        raise ValueError("SPARK_ACCESS_TOKEN_1 is not set in .env")
    
    mls_headers = {
        "Authorization": f"Bearer {spark_token}",
        "Accept": "application/json"
    }
    
    # We query the replication server for the latest 200 closed properties
    mls_url = "https://replication.sparkapi.com/Reso/OData/Property"
    
    params = {
        "$filter": "MlsStatus eq 'Closed' and ClosePrice gt 0",
        "$orderby": "CloseDate desc",
        "$top": 200,
        "$select": "ListingKey,ListingId,ParcelNumber,UnparsedAddress,ClosePrice,ListPrice,CloseDate,MlsStatus,PublicRemarks,CountyOrParish"
    }
    
    print(f"\n[MLS] Fetching latest closed properties from MLS (Top {params['$top']})...")
    response = requests.get(mls_url, headers=mls_headers, params=params, timeout=20)
    
    if response.status_code != 200:
        print(f"[MLS ERROR] Failed to fetch properties: {response.text}")
        return
        
    properties = response.json().get("value", [])
    print(f"[MLS] Retrieved {len(properties)} properties successfully.")
    
    # 3. OSINT/Filtering Keywords
    keywords = [
        "auction", "foreclosure", "reo", "bank owned", "bank-owned", 
        "short sale", "court ordered", "court-ordered", "lender approved", 
        "sheriff", "tax deed", "sold as-is", "as-is", "repost", "estate of"
    ]
    
    new_leads_count = 0
    skipped_count = 0
    
    print("\n[ANALYSIS] Filtering properties for surplus candidates...")
    for prop in properties:
        listing_key = prop.get("ListingKey")
        listing_id = prop.get("ListingId")
        parcel_id = prop.get("ParcelNumber")
        address = prop.get("UnparsedAddress")
        close_price = prop.get("ClosePrice", 0.0)
        list_price = prop.get("ListPrice", 0.0)
        close_date = prop.get("CloseDate")
        county = prop.get("CountyOrParish")
        remarks = prop.get("PublicRemarks", "")
        
        if not remarks:
            remarks = ""
            
        # Check if remarks match any keyword
        matched_keywords = [kw for kw in keywords if kw in remarks.lower()]
        
        if matched_keywords:
            print(f"\n---> MATCH FOUND: {address}")
            print(f"     ListingId: {listing_id} | County: {county}")
            print(f"     Close Price: ${close_price:,.2f} | List Price: ${list_price:,.2f}")
            print(f"     Keywords matched: {matched_keywords}")
            
            # Save lead to database
            try:
                db.execute("""
                    INSERT INTO properties (
                        listing_key, listing_id, parcel_id, address, 
                        close_price, list_price, close_date, county, 
                        remarks, owner_name, surplus_amount, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [
                    listing_key, listing_id, parcel_id, address, 
                    close_price, list_price, close_date, county, 
                    remarks, None, 0.0, "New Lead"
                ])
                print("     [DATABASE] Saved new lead successfully.")
                new_leads_count += 1
            except Exception as e:
                if "UNIQUE constraint failed" in str(e):
                    # Already exists, just skip or log
                    skipped_count += 1
                else:
                    print(f"     [DATABASE ERROR] Failed to save property: {e}")
                    
    print(f"\n==========================================")
    print(f"Summary of Lead Generation:")
    print(f"- Checked: {len(properties)} properties")
    print(f"- New Leads Captured & Saved: {new_leads_count}")
    print(f"- Existing Leads Skipped: {skipped_count}")
    print(f"==========================================")

if __name__ == "__main__":
    fetch_and_process_leads()
