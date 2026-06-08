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
    
    terms = ["remarks", "description", "public", "condition"]
    for t in terms:
        matched = [k for k in keys if t in k.lower()]
        print(f"\nMatches for '{t}':")
        for m in matched:
            print(f"  {m}: {prop.get(m)}")
else:
    print(response.text)
