"""Debug: Test parser regex against actual tipi.txt lines."""
import re
from pathlib import Path

# Same regex from setup_tipi_database.py
RE_NCM_LINE = re.compile(r'^(\d{2}(?:\.\d{2})?(?:\.\d{2})?(?:\.\d{2})?)\s+(.+?)\s+(\d+|NT|Ex \d+)?\s*$')

# Read some lines from tipi.txt
tipi_file = Path(__file__).parent.parent / "data" / "tipi.txt"
content = tipi_file.read_text(encoding='cp1252')
lines = content.split('\n')

# Find lines containing 8517
print("=== Lines containing 8517 ===")
for i, line in enumerate(lines):
    if '8517' in line:
        print(f"Line {i}: {repr(line[:80])}")
        
        # Test regex
        match = RE_NCM_LINE.match(line.strip())
        if match:
            print(f"  MATCHED: NCM={match.group(1)}, DESC_PART={match.group(2)[:30]}..., ALIQ={match.group(3)}")
        else:
            print(f"  NO MATCH")
        
        # Test with split
        parts = re.split(r'\t+|\s{2,}', line.strip())
        print(f"  SPLIT ({len(parts)} parts): {parts[:4]}")
        
        if len(parts) >= 2:
            first = parts[0].strip()
            ncm_match = re.match(r'^(\d{2}(?:\.\d{2})?(?:\.\d{2})?(?:\.\d{2})?)', first)
            if ncm_match:
                print(f"  NCM from split: {ncm_match.group(1)}")
        
        print()
