import os

# Configuration
OUTPUT_FILE = os.path.join("Scripts results", "ncm_loading_flow.txt")

# Specific files to consolidate (Paths relative to project root)
FILES_TO_INCLUDE = [
    "client/src/services/api.ts",
    "client/src/hooks/useSearch.ts",
    "client/src/context/CrossChapterNoteContext.tsx",
    "client/src/App.tsx",
    "client/src/components/ComparatorModal.tsx",
    "client/src/types/api.types.ts" # Added for context
]

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    output_path = os.path.join(project_root, OUTPUT_FILE)
    
    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    print(f"Project Root: {project_root}")
    print(f"Writing to: {output_path}")
    print("-" * 50)
    
    content_blocks = []
    total_length = 0
    
    for rel_path in FILES_TO_INCLUDE:
        abs_path = os.path.join(project_root, rel_path)
        print(f"Processing: {rel_path}...", end=" ")
        
        if not os.path.exists(abs_path):
            print(f"NOT FOUND")
            block = f"FILE: {rel_path} (NOT FOUND)\n\n"
            content_blocks.append(block)
            continue
            
        try:
            with open(abs_path, "r", encoding="utf-8") as infile:
                content = infile.read()
            
            # Create the block for this file
            block = f"{'='*50}\nFILE: {rel_path}\n{'='*50}\n{content}\n\n"
            content_blocks.append(block)
            total_length += len(block)
            print("OK")
        except Exception as e:
            print(f"ERROR: {e}")
            block = f"FILE: {rel_path} (Reading Error: {e})\n\n"
            content_blocks.append(block)

    # Check for size warning
    if total_length > 120000:
        print(f"\n⚠️  WARNING: Total size ({total_length} chars) exceeds 120,000 limit!")

    # Write everything to file
    with open(output_path, "w", encoding="utf-8") as outfile:
        if total_length > 120000:
            outfile.write(f"⚠️ WARNING: TOTAL CONTENT LENGTH ({total_length}) EXCEEDS 120,000 CHARACTERS!\n")
            outfile.write(f"{'='*50}\n\n")
            
        for block in content_blocks:
            outfile.write(block)

    print("-" * 50)
    print(f"Done! Consolidated {len(content_blocks)} files to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
