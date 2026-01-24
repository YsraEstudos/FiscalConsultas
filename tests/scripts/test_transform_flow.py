"""Debug the content transformation flow."""
import sys
import os
import re
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.presentation.renderer import HtmlRenderer

# Pattern from renderer.py
pattern = re.compile(r'^\s*\*\*(\d{2,4}\.\d{2}(?:\.\d{2})?)\s*-\s*(.+?)\*\*\s*$', re.MULTILINE)

# Sample raw content
raw = """**85.03 - Partes reconhecíveis como exclusiva ou principalmente destinadas às máquinas**

Ressalvadas as disposições gerais.

**85.04 - Transformadores elétricos**

Bobinas de reatância."""

print("=== RAW CONTENT ===")
print(raw[:500])
print("\n=== REGEX TEST ON RAW ===")
matches = pattern.findall(raw)
print(f"Matches: {matches}")

# Simulate the pipeline
content = HtmlRenderer.clean_content(raw)
print("\n=== AFTER clean_content ===")
print(repr(content[:300]))
matches = pattern.findall(content)
print(f"Matches: {matches}")

content = HtmlRenderer.inject_note_links(content)
print("\n=== AFTER inject_note_links ===")
matches = pattern.findall(content)
print(f"Matches: {matches}")

content = HtmlRenderer.inject_smart_links(content, "85")
print("\n=== AFTER inject_smart_links ===")
print(repr(content[:500]))
matches = pattern.findall(content)
print(f"Matches: {matches}")
