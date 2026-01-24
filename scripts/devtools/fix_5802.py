import sqlite3

DB_PATH = "nesh.db"

def fix_5802():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT content FROM chapters WHERE chapter_num = '58'")
    row = cursor.fetchone()
    
    if not row:
        print("Chapter 58 not found")
        return

    content = row[0]
    
    # The target string pattern identified
    # It might have varying whitespace, so let's be precise based on previous output
    # Previous output: '...exceto os \n\n**artigos da posição 57.03.**\n\n5802.10...'
    
    target_fragment = "\n\n**artigos da posição 57.03.**"
    replacement = " artigos da posição 57.03."
    
    if target_fragment in content:
        print(f"Found target fragment. Replacing...")
        new_content = content.replace(target_fragment, replacement)
        
        cursor.execute("UPDATE chapters SET content = ? WHERE chapter_num = '58'", (new_content,))
        conn.commit()
        print("Update committed.")
    else:
        print("Target fragment not found strictly. Trying with looser whitespace...")
        # Try finding just bolded part
        bold_target = "**artigos da posição 57.03.**"
        if bold_target in content:
             print("Found bold target. Removing bold.")
             new_content = content.replace(bold_target, "artigos da posição 57.03.")
             cursor.execute("UPDATE chapters SET content = ? WHERE chapter_num = '58'", (new_content,))
             conn.commit()
             print("Update committed.")
        else:
             print("Could not find pattern to fix.")

    conn.close()

if __name__ == "__main__":
    fix_5802()
