import sqlite3
import sys

conn = sqlite3.connect("nesh.db")
cursor = conn.cursor()

cursor.execute("SELECT content FROM chapters WHERE chapter_num = '58'")
row = cursor.fetchone()
if row:
    content = row[0]
    # Find the problematic area
    target = "57.03"
    idx = content.find(target)
    if idx != -1:
        # Get enough context
        snippet = content[max(0, idx-100):idx+100]
        print(repr(snippet))
    else:
        print("Target not found")
else:
    print("Chapter not found")
conn.close()
