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
    "$top": 200,
    "$select": "CountyOrParish,StateOrProvince"
}

print("Querying unique counties and states in the MLS feed...")
response = requests.get(url, headers=headers, params=params)
if response.status_code == 200:
    properties = response.json().get("value", [])
    counties_states = set()
    for prop in properties:
        c = prop.get("CountyOrParish")
        s = prop.get("StateOrProvince")
        if c or s:
            counties_states.add(f"{c}, {s}")
            
    print(f"\nUnique Counties & States found in sample of 200 properties:")
    for cs in sorted(counties_states):
        print(f"  - {cs}")
else:
    print(response.text)
