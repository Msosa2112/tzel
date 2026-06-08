import os
import requests
from dotenv import load_dotenv

load_dotenv()

url = os.getenv("TURSO_DATABASE_URL")
if url.startswith("libsql://"):
    url = url.replace("libsql://", "https://")
token = os.getenv("TURSO_AUTH_TOKEN")

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# Read schema.sql
with open("schema.sql", "r") as f:
    sql = f.read()

payload = {
    "requests": [
        {
            "type": "execute",
            "stmt": {
                "sql": sql
            }
        },
        {
            "type": "close"
        }
    ]
}

print("Applying schema.sql to Turso database...")
response = requests.post(f"{url}/v2/pipeline", headers=headers, json=payload)
print(f"Status Code: {response.status_code}")
if response.status_code == 200:
    res = response.json()
    first_res = res.get("results", [])[0]
    if first_res.get("type") == "error":
        print(f"[ERROR] failed to apply: {first_res['error']['message']}")
    else:
        print("[SUCCESS] Table 'osint_opportunities' created in Turso!")
else:
    print(f"[ERROR] HTTP Error: {response.text}")
