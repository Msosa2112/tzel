import os
import requests
from dotenv import load_dotenv

load_dotenv()

token = os.getenv("SPARK_ACCESS_TOKEN_1")
headers = {
    "Authorization": f"Bearer {token}",
    "Accept": "application/json"
}

url = "https://replication.sparkapi.com/Reso/OData/Property"
params = {
    "$top": 1
}

print("Fetching one property record to inspect fields...")
response = requests.get(url, headers=headers, params=params)
print(f"Status Code: {response.status_code}")
if response.status_code == 200:
    data = response.json()
    if 'value' in data and len(data['value']) > 0:
        prop = data['value'][0]
        print("\nAll Fields and Values in a Sample Property:")
        import json
        # Filter out keys with None values to keep it clean, or print everything
        print(json.dumps(prop, indent=2))
    else:
        print("No value found.")
else:
    print(response.text)
