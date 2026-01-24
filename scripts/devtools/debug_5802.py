import sqlite3
import sys

conn = sqlite3.connect("nesh.db")
cursor = conn.cursor()

cursor.execute("SELECT content FROM chapters WHERE chapter_num = '58'")
row = cursor.fetchone()
if row:
    content = row[0]
    # Find the problematic area
    target = "58.02 -"
    idx = content.find(target)
    if idx != -1:
        # Get enough context
        snippet = content[idx:idx+300]
        print(repr(snippet))
    else:
        print("Target not found")
else:
    print("Chapter not found")
conn.close()
