
import os

# Configuration
OUTPUT_FILE = "consolidated_code.txt"

# Extensions to include
INCLUDE_EXTENSIONS = {'.py', '.ts', '.tsx', '.css', '.js', '.jsx', '.html', '.md', '.json', '.sql', '.toml', '.yml', '.yaml'}

# Directories to exclude
EXCLUDE_DIRS = {
    'node_modules', 
    '__pycache__', 
    '.git', 
    '.vscode', 
    '.idea', 
    'dist', 
    'build', 
    'coverage', 
    '.pytest_cache', 
    'assets', 
    'public',
    'venv',
    'env',
    '.venv'  # Added this
}

# Files to exclude specifically
EXCLUDE_FILES = {
    'package-lock.json', 
    'yarn.lock', 
    'pnpm-lock.yaml', 
    'consolidated_code.txt', 
    '.DS_Store'
}

def is_source_file(filename):
    return any(filename.endswith(ext) for ext in INCLUDE_EXTENSIONS) and filename not in EXCLUDE_FILES

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    output_path = os.path.join(project_root, OUTPUT_FILE)
    
    print(f"Project Root: {project_root}")
    print(f"Writing to: {output_path}")
    print("-" * 50)
    
    files_collected = []
    
    for root, dirs, files in os.walk(project_root):
        # Modify dirs in-place to skip excluded directories
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        
        for file in files:
            if is_source_file(file):
                file_path = os.path.join(root, file)
                if os.path.abspath(file_path) == os.path.abspath(output_path):
                    continue
                rel_path = os.path.relpath(file_path, project_root)
                files_collected.append((rel_path, file_path))

    # Sort validation for deterministic output
    files_collected.sort()

    with open(output_path, "w", encoding="utf-8") as outfile:
        for rel_path, abs_path in files_collected:
            print(f"Processing: {rel_path}...", end=" ")
            try:
                with open(abs_path, "r", encoding="utf-8") as infile:
                    content = infile.read()
                    
                outfile.write(f"{'='*50}\n")
                outfile.write(f"FILE: {rel_path}\n")
                outfile.write(f"{'='*50}\n")
                outfile.write(content)
                outfile.write("\n\n")
                print("OK")
            except Exception as e:
                print(f"ERROR: {e}")
                outfile.write(f"FILE: {rel_path} (Reading Error: {e})\n\n")

    print("-" * 50)
    print(f"Done! Consolidated {len(files_collected)} files to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
