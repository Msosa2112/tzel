import os
import requests
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("SPARK_ACCESS_TOKEN_1")
url = "https://replication.sparkapi.com/Reso/OData/Property"
headers = {
    "Authorization": f"Bearer {token}",
    "Accept": "application/json"
}

# Let's test contains
params = {
    "$filter": "contains(UnparsedAddress, '6401') and StateOrProvince eq 'KY'",
    "$top": 5,
    "$select": "ListingId,UnparsedAddress,StateOrProvince,CountyOrParish"
}

print("Querying MLS for contains(UnparsedAddress, '6401')...")
res = requests.get(url, headers=headers, params=params)
print("Status:", res.status_code)
if res.status_code == 200:
    print("Response JSON:")
    print(res.json())
else:
    print("Error:")
    print(res.text)
