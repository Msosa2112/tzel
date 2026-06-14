import os
from dotenv import load_dotenv
import requests

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
        response = requests.post(self.url, headers=self.headers, json=payload, timeout=10)
        if response.status_code == 200:
            res_json = response.json()
            results = res_json.get("results", [])
            if results and results[0].get("type") == "response":
                return results[0].get("response", {}).get("result", {})
        raise Exception(f"Failed to query database: {response.text}")

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

try:
    client = TursoClient()
    res = client.execute("SELECT auction_id, case_number, address, county, plaintiff, defendant, needs_manual_review, auction_date FROM foreclosure_auctions WHERE state = 'IN'")
    columns = res.get("cols", [])
    rows = res.get("rows", [])
    print(f"Total Indiana rows in DB: {len(rows)}")
    for r in rows:
        p = parse_row(r, columns)
        print(f"ID: {p['auction_id']}\n  Case: {p['case_number']}\n  Addr: {p['address']}\n  Date: {p['auction_date']}\n  Plnt: {p['plaintiff']} | Def: {p['defendant']} | Manual: {p['needs_manual_review']}\n")
except Exception as e:
    print("Error:", e)

