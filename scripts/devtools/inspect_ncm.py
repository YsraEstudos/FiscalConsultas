import argparse
import sqlite3
import re
import sys
import os
from pathlib import Path

# Default DB path relative to script: ../../nesh.db
DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent.parent / "nesh.db"

def get_db_connection(db_path):
    if not Path(db_path).exists():
        print(f"Error: Database not found at {db_path}")
        sys.exit(1)
    return sqlite3.connect(db_path)

def cmd_content(args):
    conn = get_db_connection(args.db)
    cursor = conn.cursor()
    
    chapter = args.chapter.zfill(2)
    cursor.execute("SELECT content FROM chapters WHERE chapter_num = ?", (chapter,))
    row = cursor.fetchone()
    
    if not row:
        print(f"Chapter {chapter} not found.")
        return
        
    content = row[0]
    
    if args.ncm:
        idx = content.find(args.ncm)
        if idx >= 0:
            start = max(0, idx - args.context)
            end = min(len(content), idx + len(args.ncm) + args.context)
            snippet = content[start:end]
            print(f"=== Context around '{args.ncm}' in Chapter {chapter} ===")
            print(f"Position: {idx}")
            print("-" * 40)
            print(repr(snippet))
            print("-" * 40)
            print(snippet)
        else:
            print(f"NCM '{args.ncm}' not found in Chapter {chapter} content.")
    else:
        print(f"=== Content of Chapter {chapter} (First {args.context} chars) ===")
        print(content[:args.context])

def cmd_regex(args):
    conn = get_db_connection(args.db)
    cursor = conn.cursor()
    
    chapter = args.chapter.zfill(2)
    cursor.execute("SELECT content FROM chapters WHERE chapter_num = ?", (chapter,))
    row = cursor.fetchone()
    
    if not row:
        print(f"Chapter {chapter} not found.")
        return
        
    content = row[0]
    
    pattern_str = args.pattern
    # Safe compile
    try:
        pattern = re.compile(pattern_str, re.MULTILINE)
    except re.error as e:
        print(f"Invalid regex: {e}")
        return
        
    matches = pattern.findall(content)
    print(f"Found {len(matches)} matches for pattern: {pattern_str}")
    
    for i, m in enumerate(matches[:args.limit]):
        # Handle groups vs string match
        if isinstance(m, tuple) and len(m) > 1:
             display = f"{m[0]}: {m[1][:60]}..."
        elif isinstance(m, str):
             display = m[:100]
        else:
             display = str(m)[:100]

        print(f"  {i+1}. {display}")

def main():
    parser = argparse.ArgumentParser(description="Inspect NESH Database Content")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="Path to sqlite database")
    
    subparsers = parser.add_subparsers(dest="command", required=True)
    
    # Content Inspector
    p_content = subparsers.add_parser("content", help="Inspect raw content")
    p_content.add_argument("--chapter", required=True, help="Chapter number (e.g. 85)")
    p_content.add_argument("--ncm", help="Find specific string/NCM")
    p_content.add_argument("--context", type=int, default=500, help="Chars of context")
    p_content.set_defaults(func=cmd_content)
    
    # Regex Tester
    p_regex = subparsers.add_parser("regex", help="Test regex against content")
    p_regex.add_argument("--chapter", required=True, help="Chapter number")
    p_regex.add_argument("--pattern", required=True, help="Regex pattern")
    p_regex.add_argument("--limit", type=int, default=20, help="Max matches to show")
    p_regex.set_defaults(func=cmd_regex)
    
    args = parser.parse_args()
    if hasattr(args, 'func'):
        args.func(args)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
