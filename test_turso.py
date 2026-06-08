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
        # Format arguments based on their Python type to match Turso JSON format
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
        
        response = requests.post(self.url, headers=self.headers, json=payload, timeout=10)
        if response.status_code == 200:
            res_json = response.json()
            results = res_json.get("results", [])
            if not results or len(results) == 0:
                raise Exception("Empty response from database")
            
            first_result = results[0]
            if first_result.get("type") == "error":
                error_msg = first_result.get("error", {}).get("message", "Unknown database error")
                raise Exception(error_msg)
            
            # Extract actual result data
            execute_resp = first_result.get("response", {})
            return execute_resp.get("result", {})
        else:
            raise Exception(f"HTTP Error {response.status_code}: {response.text}")

def parse_row(row, columns):
    parsed = {}
    for i, col in enumerate(columns):
        col_name = col["name"]
        val_obj = row[i]
        val_type = val_obj.get("type")
        if val_type == "null":
            parsed[col_name] = None
        elif val_type == "integer":
            parsed[col_name] = int(val_obj.get("value"))
        elif val_type == "float":
            parsed[col_name] = float(val_obj.get("value"))
        else:
            parsed[col_name] = val_obj.get("value")
    return parsed

def run_test():
    try:
        client = TursoClient()
        print(f"Connecting to Turso via HTTP Pipeline: {client.url} ...")

        # 1. Create table
        print("Creating 'properties' table...")
        client.execute("""
            CREATE TABLE IF NOT EXISTS properties (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parcel_id TEXT UNIQUE,
                address TEXT,
                owner_name TEXT,
                surplus_amount REAL,
                status TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        print("[SUCCESS] Table created or already exists.")

        # 2. Insert mock data
        print("Inserting mock surplus funds lead...")
        try:
            client.execute("""
                INSERT INTO properties (parcel_id, address, owner_name, surplus_amount, status)
                VALUES (?, ?, ?, ?, ?)
            """, ["123-456-789", "100 Main St, Louisville, KY", "John Doe", 70000.00, "New"])
            print("[SUCCESS] Mock data inserted successfully.")
        except Exception as e:
            if "UNIQUE constraint failed" in str(e):
                print("[INFO] Mock data already exists in database.")
            else:
                raise e

        # 3. Query properties
        print("Querying properties:")
        results = client.execute("SELECT id, parcel_id, address, owner_name, surplus_amount, status FROM properties LIMIT 5")
        
        columns = results.get("cols", [])
        rows = results.get("rows", [])
        
        for row in rows:
            parsed = parse_row(row, columns)
            print(f"- ID: {parsed['id']}, Parcel: {parsed['parcel_id']}, Address: {parsed['address']}, Owner: {parsed['owner_name']}, Surplus: ${parsed['surplus_amount']:,.2f}, Status: {parsed['status']}")

    except Exception as e:
        print(f"[ERROR] Test failed: {e}")

if __name__ == "__main__":
    run_test()
