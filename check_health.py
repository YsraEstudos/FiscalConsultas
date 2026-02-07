import requests
import sys

def check_search(ncm):
    print(f"Testing search for: {ncm}")
    try:
        resp = requests.get(f"http://127.0.0.1:8000/api/search?ncm={ncm}", timeout=5)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            print("Success!")
            return True
        else:
            print(f"Failed: {resp.text}")
            return False
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == "__main__":
    if not check_search("8417"):
        sys.exit(1)
    if not check_search("4908.90.00"):
        sys.exit(1)
