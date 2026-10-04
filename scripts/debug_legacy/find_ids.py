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

response = requests.get(url, headers=headers, params=params)
if response.status_code == 200:
    prop = response.json()['value'][0]
    keys = list(prop.keys())
    
    terms = ["key", "id", "mls", "listingid"]
    for t in terms:
        matched = [k for k in keys if t in k.lower()]
        print(f"\nMatches for '{t}':")
        for m in matched[:15]:
            print(f"  {m}: {prop.get(m)}")
        if len(matched) > 15:
            print("  ... and more")
else:
    print(response.text)
