with open("backend/presentation/routes/system.py", "r") as f:
    content = f.read()

# Fix Line 336 issue (unnecessary string formatting without args)
content = content.replace('f"status:ip:{extract_client_ip(request)}"', 'f"status:ip:{extract_client_ip(request)}"') # wait it looks like f-string is used

import re
matches = re.finditer(r'(.*)(Line: \d+)(.*)', content)
# Wait, let's actually run the linter to see the issues
