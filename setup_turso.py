import os
import requests
from dotenv import load_dotenv

load_dotenv()

# Load platform token from environment variable
TOKEN = os.getenv("TURSO_PLATFORM_TOKEN")
if not TOKEN:
    print("[ERROR] Please set TURSO_PLATFORM_TOKEN in your environment or .env file.")
    exit(1)

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json"
}

def setup():
    # 1. Get organizations
    url = "https://api.turso.tech/v1/organizations"
    print("Fetching organizations...")
    response = requests.get(url, headers=headers)
    print(f"Status: {response.status_code}")
    if response.status_code != 200:
        print(f"Error: {response.text}")
        return
    
    orgs = response.json()
    print("Organizations:")
    for org in orgs:
        print(f"- Name: {org['name']}, Slug: {org['slug']}, Type: {org['type']}")
    
    # We will use the first organization slug (should be personal/msosa2112)
    org_slug = orgs[0]['slug']
    print(f"\nUsing Organization Slug: {org_slug}")
    
    # 2. Check if a database named 'tzel-surplus' already exists, if not, create it
    db_name = "tzel-surplus"
    print(f"\nChecking if database '{db_name}' exists...")
    list_url = f"https://api.turso.tech/v1/organizations/{org_slug}/databases"
    response = requests.get(list_url, headers=headers)
    if response.status_code != 200:
        print(f"Error listing databases: {response.text}")
        return
        
    databases = response.json().get("databases", [])
    db_exists = False
    db_url = None
    for db in databases:
        db_name_actual = db.get("Name") or db.get("name")
        if db_name_actual == db_name:
            db_exists = True
            db_url = f"libsql://{db.get('Hostname') or db.get('hostname')}"
            print(f"Database '{db_name}' already exists. URL: {db_url}")
            break
            
    if not db_exists:
        print(f"Database '{db_name}' not found. Creating it...")
        # To create a database, we need a group. Let's find or create a group first, or just try to use 'default'
        # Let's list groups
        groups_url = f"https://api.turso.tech/v1/organizations/{org_slug}/groups"
        g_resp = requests.get(groups_url, headers=headers)
        group_name = "default"
        if g_resp.status_code == 200:
            groups = g_resp.json().get("groups", [])
            if groups:
                group_name = groups[0]["name"]
                print(f"Using existing group: {group_name}")
            else:
                print("No groups found. Let's create 'default' group...")
                create_group_url = f"https://api.turso.tech/v1/organizations/{org_slug}/groups"
                cg_resp = requests.post(create_group_url, headers=headers, json={"name": "default", "location": "aws-us-east-1"}) # US East (Virginia)
                if cg_resp.status_code == 200:
                    print("Group 'default' created.")
                else:
                    print(f"Failed to create group: {cg_resp.text}")
                    return
        
        create_db_url = f"https://api.turso.tech/v1/organizations/{org_slug}/databases"
        payload = {
            "name": db_name,
            "group": group_name
        }
        create_resp = requests.post(create_db_url, headers=headers, json=payload)
        print(f"Create DB Status: {create_resp.status_code}")
        if create_resp.status_code == 200:
            db_info = create_resp.json().get("database", {})
            db_url = f"libsql://{db_info.get('Hostname')}"
            print(f"[SUCCESS] Created database '{db_name}'. URL: {db_url}")
        else:
            print(f"Failed to create database: {create_resp.text}")
            return
            
    # 3. Create/Retrieve a connection token for the database
    print(f"\nGenerating connection token for database '{db_name}'...")
    token_url = f"https://api.turso.tech/v1/organizations/{org_slug}/databases/{db_name}/auth/tokens"
    token_resp = requests.post(token_url, headers=headers)
    db_token = None
    if token_resp.status_code == 200:
        db_token = token_resp.json().get("jwt")
        print("[SUCCESS] Connection token generated.")
    else:
        print(f"Failed to generate connection token: {token_resp.text}")
        return

    # 4. Save to .env file
    if db_url and db_token:
        # Read current .env
        env_content = ""
        if os.path.exists(".env"):
            with open(".env", "r") as f:
                env_content = f.read()
        
        # Check if already present, if so remove/update
        lines = env_content.splitlines()
        new_lines = []
        for line in lines:
            if not line.startswith("TURSO_") and not line.startswith("TURSO_"):
                new_lines.append(line)
        
        new_lines.append(f"TURSO_DATABASE_URL={db_url}")
        new_lines.append(f"TURSO_AUTH_TOKEN={db_token}")
        
        with open(".env", "w") as f:
            f.write("\n".join(new_lines) + "\n")
            
        print("\n[SUCCESS] Saved TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to .env!")

if __name__ == "__main__":
    setup()
