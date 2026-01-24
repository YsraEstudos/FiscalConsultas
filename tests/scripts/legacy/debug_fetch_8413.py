
import requests
import json
import re

URL = "http://localhost:8000/api/search?ncm=8413"

try:
    print(f"Fetching {URL}...")
    resp = requests.get(URL)
    resp.raise_for_status()
    data = resp.json()
    
    print("Response type:", data.get("type"))
    
    markdown = data.get("markdown", "")
    print(f"Markdown length: {len(markdown)}")
    
    # Check for the expected anchor
    target_id = "pos-84-13"
    if f'id="{target_id}"' in markdown:
        print(f"✅ FOUND anchor: id=\"{target_id}\"")
        # Print context
        idx = markdown.find(target_id)
        start = max(0, idx - 100)
        end = min(len(markdown), idx + 100)
        print(f"Context:\n...{markdown[start:end]}...")
    else:
        print(f"❌ NOT FOUND anchor: id=\"{target_id}\"")
        
    # Check for alternative IDs
    matches = re.findall(r'id="(pos-[^"]+)"', markdown)
    print(f"Found {len(matches)} position anchors. Examples: {matches[:5]}")
    
except Exception as e:
    print(f"Error: {e}")
