import requests

url = "https://sonarcloud.io/api/issues/search?componentKeys=YsraEstudos_FiscalConsultas&pullRequest=173&resolved=false"
response = requests.get(url)
if response.status_code == 200:
    issues = response.json().get("issues", [])
    for issue in issues:
        print(f"File: {issue.get('component')}")
        print(f"Line: {issue.get('line')}")
        print(f"Message: {issue.get('message')}")
        print(f"Rule: {issue.get('rule')}")
        print("-" * 40)
else:
    print(f"Failed to get issues: {response.status_code}")
    print(response.text)
