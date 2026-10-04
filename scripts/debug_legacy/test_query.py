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
    "$filter": "MlsStatus eq 'Closed' and ClosePrice gt 0",
    "$orderby": "CloseDate desc",
    "$top": 5,
    "$select": "ListingKey,ListingId,ParcelNumber,UnparsedAddress,ClosePrice,ListPrice,CloseDate,MlsStatus,PublicRemarks,CountyOrParish"
}

print("Running test query on MLS for recently closed properties...")
response = requests.get(url, headers=headers, params=params)
print(f"Status Code: {response.status_code}")
if response.status_code == 200:
    data = response.json()
    value = data.get("value", [])
    print(f"Found {len(value)} properties.")
    for i, prop in enumerate(value):
        print(f"\n--- Property {i+1}: ---")
        print(f"ListingId: {prop.get('ListingId')}")
        print(f"Address: {prop.get('UnparsedAddress')}")
        print(f"ParcelNumber: {prop.get('ParcelNumber')}")
        print(f"ClosePrice: ${prop.get('ClosePrice'):,.2f} (ListPrice: ${prop.get('ListPrice'):,.2f})")
        print(f"CloseDate: {prop.get('CloseDate')}")
        print(f"County: {prop.get('CountyOrParish')}")
        remarks = prop.get('PublicRemarks', '')
        print(f"Remarks: {remarks[:100]}...")
else:
    print(response.text)
