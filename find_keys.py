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
    
    terms = ["street", "city", "state", "postal", "address", "county", "unparsed"]
    matches = {t: [] for t in terms}
    
    for key in keys:
        for t in terms:
            if t in key.lower():
                matches[t].append(key)
                
    for t, matched_keys in matches.items():
        print(f"\n--- Keys matching '{t}' ({len(matched_keys)}): ---")
        for mk in matched_keys[:20]:
            print(f"  {mk}: {prop.get(mk)}")
else:
    print(response.text)
