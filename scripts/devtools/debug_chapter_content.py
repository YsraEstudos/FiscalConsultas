import sqlite3
import os

DB_FILE = os.path.join(os.path.dirname(__file__), "..", "nesh.db")
conn = sqlite3.connect(DB_FILE)
cursor = conn.cursor()

print("Fetching content for Chapter 73...")
cursor.execute("SELECT content FROM chapters WHERE chapter_num = '73'")
row = cursor.fetchone()

if row:
    content = row[0]
    print(f"Content length: {len(content)}")
    
    # Find the problematic string
    target = "XV-7324-1"
    index = content.find(target)
    
    if index != -1:
        print(f"\nFOUND '{target}' at index {index}!")
        start = max(0, index - 100)
        end = min(len(content), index + 100)
        context = content[start:end]
        print(f"Context:\n{'-'*20}\n{context}\n{'-'*20}")
    else:
        print(f"\nString '{target}' NOT FOUND in Chapter 73 content.")
        
        # Try finding 73.24
        print("Checking around '73.24 -'")
        idx = content.find("73.24 -")
        if idx != -1:
             print(f"Found '73.24 -' at {idx}:")
             print(content[idx:idx+100])

conn.close()
