import sqlite3, os

nesh = sqlite3.connect("database/nesh.db")
c = nesh.cursor()

# Chapters content
c.execute("SELECT SUM(length(content)) FROM chapters")
total_content = c.fetchone()[0] or 0
print(f"Chapters content: {total_content/1024/1024:.1f} MB")

# Chapter notes
c.execute("SELECT SUM(length(notes_content)) + SUM(length(titulo)) + SUM(length(notas)) + SUM(length(consideracoes)) + SUM(length(definicoes)) + SUM(length(parsed_notes_json)) FROM chapter_notes")
total_notes = c.fetchone()[0] or 0
print(f"Chapter notes: {total_notes/1024/1024:.1f} MB")

# Positions
c.execute("SELECT COUNT(*) FROM positions")
print(f"Positions count: {c.fetchone()[0]}")

# File sizes
print(f"\nnesh.db: {os.path.getsize('database/nesh.db')/1024/1024:.1f} MB")
print(f"fiscal_offline.enc: {os.path.getsize('database/fiscal_offline.enc')/1024/1024:.1f} MB")

grand_total = total_content + total_notes
print(f"\nNESH content to add: {grand_total/1024/1024:.1f} MB")
print(f"Estimated new offline DB: {(os.path.getsize('database/fiscal_offline.enc') + grand_total)/1024/1024:.1f} MB")

nesh.close()
