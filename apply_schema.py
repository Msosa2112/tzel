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

# Read schema.sql and split by semicolon, filtering out empty statements and comments
with open("schema.sql", "r") as f:
    raw_sql = f.read()

# Split statements by semicolon
raw_statements = raw_sql.split(";")
statements = []
for stmt in raw_statements:
    # Strip comments first
    clean_lines = []
    for line in stmt.splitlines():
        line_stripped = line.strip()
        if line_stripped and not line_stripped.startswith("--"):
            # Strip trailing comments if any
            if "--" in line:
                line = line.split("--")[0]
            clean_lines.append(line.rstrip())
    stmt = "\n".join(clean_lines).strip()
    if stmt:
        statements.append(stmt)

print(f"Parsed {len(statements)} SQL statements from schema.sql.")

requests_list = []
for stmt in statements:
    requests_list.append({
        "type": "execute",
        "stmt": {
            "sql": stmt
        }
    })
requests_list.append({"type": "close"})

payload = {
    "requests": requests_list
}

print("Applying schema.sql to Turso database via pipeline...")
response = requests.post(f"{url}/v2/pipeline", headers=headers, json=payload)
print(f"Status Code: {response.status_code}")

if response.status_code == 200:
    res = response.json()
    results = res.get("results", [])
    has_error = False
    for i, result in enumerate(results):
        if result.get("type") == "error":
            print(f"[ERROR] Statement #{i+1} failed: {result['error']['message']}")
            has_error = True
            break
    if not has_error:
        print("[SUCCESS] Schema applied successfully! All tables created in Turso.")
else:
    print(f"[ERROR] HTTP Error: {response.text}")

