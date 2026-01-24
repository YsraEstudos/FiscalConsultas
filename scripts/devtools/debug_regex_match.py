"""Test regex against actual DB content."""
import sqlite3
import re

DB_PATH = r"c:\Users\israe\Downloads\faz tudo\Fiscal\nesh.db"

# The RE_NCM_HEADING pattern from renderer.py (updated)
PATTERN = re.compile(r'^\s*(?:\*\*)?(\d{2,4}\.\d{2}(?:\.\d{2})?)\s*(?:\*\*)?\s*[-–—:]\s*(.+?)(?:\*\*)?\s*$', re.MULTILINE)

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# Get chapter 85 content
cur.execute("SELECT content FROM chapters WHERE chapter_num = ?", ("85",))
row = cur.fetchone()

if not row:
    print("Chapter 85 not found!")
else:
    content = row[0]
    
    # Print first 2000 chars for structure analysis
    print("=== FIRST 2000 CHARS ===")
    print(content[:2000])
    print("\n=== REGEX MATCHES ===")
    
    matches = PATTERN.findall(content)
    print(f"Found {len(matches)} matches:")
    for m in matches[:15]:
        print(f"  {m[0]}: {m[1][:60]}...")
    
    if not matches:
        print("\nNo matches! Testing alternative patterns...")
        # Try simpler pattern
        alt_pattern = re.compile(r'\*\*(\d{2,4}\.\d{2})\*\*\s*-\s*(.+)', re.MULTILINE)
        alt_matches = alt_pattern.findall(content)
        print(f"Alt pattern found {len(alt_matches)} matches:")
        for m in alt_matches[:5]:
            print(f"  {m[0]}: {m[1][:60]}...")

conn.close()
