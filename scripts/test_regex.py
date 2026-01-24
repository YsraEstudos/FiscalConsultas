import re

test_cases = [
    "ver Nota 2 deste Capítulo",
    "conforme Nota 5",
    "ver Notas 2 e 3",
    "Nota 1",
    "nota 4",
    "(ver Nota 3)",
    "Notas 1, 2 e 4",
    "Nota 4 da Seção XVI"
]

current_pattern = r'(Nota[s]?\s+(\d+))'

print("--- Current Pattern Results ---")
for text in test_cases:
    matches = re.findall(current_pattern, text)
    print(f"'{text}': {matches}")

print("\n--- New Pattern Logic ---")
# Improved regex to catch "Nota X", "Notas X e Y", "nota X" (case insensitive)
# We might need to execute this in Python code to handle the replacement logic better than just a simple sub if we want to handle "Notas 2 e 3" properly.
# For now, let's just try to match individual "Nota X" occurrences better.
new_pattern = r'(?i)\b(nota[s]?)\s+(\d+(?:\s*(?:,|e)\s*\d+)*)'

for text in test_cases:
    matches = re.findall(new_pattern, text)
    print(f"'{text}': {matches}")
