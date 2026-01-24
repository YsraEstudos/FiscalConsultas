"""
Diagnostic script to inspect the raw content format stored in the nesh.db database.
This helps understand why NESH formatting is not working correctly.
"""

import os
import sqlite3
import sys

# Find the database path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.path.join(PROJECT_ROOT, "nesh.db")

def inspect_chapter_content(chapter_num: str = "85"):
    """Inspect raw content from a chapter to understand its format."""
    
    print(f"Database path: {DB_PATH}")
    print(f"Database exists: {os.path.exists(DB_PATH)}")
    
    if not os.path.exists(DB_PATH):
        print("ERROR: Database not found!")
        return
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get chapter content
    cursor.execute("SELECT content FROM chapters WHERE chapter_num = ?", (chapter_num,))
    row = cursor.fetchone()
    
    if not row:
        print(f"Chapter {chapter_num} not found!")
        return
    
    content = row['content']
    
    print(f"\n{'='*60}")
    print(f"CHAPTER {chapter_num} CONTENT ANALYSIS")
    print(f"{'='*60}")
    print(f"Total length: {len(content)} characters")
    print(f"Number of lines: {content.count(chr(10))}")
    print(f"Number of double newlines: {content.count(chr(10)+chr(10))}")
    
    # Check for markdown-like patterns
    print(f"\n--- Pattern Detection ---")
    print(f"Contains '###': {content.count('###')}")
    print(f"Contains '##': {content.count('##')}")
    print(f"Contains '- ' (list): {content.count(chr(10) + '- ')}")
    print(f"Contains '1.' (numbered list): {content.count(chr(10) + '1.')}")
    print(f"Contains '<p>': {content.count('<p>')}")
    print(f"Contains '<div>': {content.count('<div>')}")
    
    # Show first 2000 characters
    print(f"\n--- First 2000 Characters (RAW) ---")
    print(repr(content[:2000]))
    
    print(f"\n--- First 2000 Characters (RENDERED) ---")
    print(content[:2000])
    
    conn.close()

if __name__ == "__main__":
    chapter = sys.argv[1] if len(sys.argv) > 1 else "85"
    inspect_chapter_content(chapter)
