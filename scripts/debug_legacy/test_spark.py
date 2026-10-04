import os
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Tokens to test
tokens = {
    "Feed 1 (emf3z79...)": os.getenv("SPARK_ACCESS_TOKEN_1"),
    "Feed 2 (92555rj...)": os.getenv("SPARK_ACCESS_TOKEN_2")
}

# Endpoints to test
endpoints = [
    "https://api.sparkapi.com/Reso/OData",
    "https://replication.sparkapi.com/Reso/OData"
]

def test_connection():
    for name, token in tokens.items():
        if not token:
            print(f"[ERROR] Token not found in .env for {name}")
            continue
        
        print(f"\n=== Testing {name} ===")
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json"
        }
        
        for base_url in endpoints:
            # Test simple service document call
            url = f"{base_url}/Property"
            params = {
                "$top": 1  # Only fetch 1 record for validation
            }
            print(f"Requesting: {url} ...")
            try:
                response = requests.get(url, headers=headers, params=params, timeout=10)
                print(f"Status Code: {response.status_code}")
                if response.status_code == 200:
                    data = response.json()
                    print(f"[SUCCESS] Connected! Found data.")
                    # Print keys of first result if available
                    if 'value' in data and len(data['value']) > 0:
                        first_item = data['value'][0]
                        print("Keys available in Property resource:")
                        print(list(first_item.keys())[:10], "... and more")
                    else:
                        print("No property records returned but response was successful.")
                else:
                    print(f"[FAILED] Error response: {response.text[:200]}")
            except Exception as e:
                print(f"[EXCEPTION] Failed to request {url}: {e}")

if __name__ == "__main__":
    test_connection()
