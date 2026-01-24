import sys
import os

# Add current directory to path
sys.path.append(os.getcwd())

try:
    # Try parsing Nesh.py to check for syntax errors
    with open('Nesh.py', 'r') as f:
        compile(f.read(), 'Nesh.py', 'exec')
    print("Syntax check passed.")
except Exception as e:
    print(f"Syntax error: {e}")
    sys.exit(1)

# specific imports check if needed, but syntax is a good start.
# If Nesh.py has runtime startup errors, we might not catch them unless we run it.
