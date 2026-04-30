const fs = require('fs');
const path = require('path');

/**
 * Script to audit file lengths in the project.
 * Focuses on identifying large files that might need refactoring.
 */

const TARGET_DIR = process.argv[2] || path.join(__dirname, '..', 'src');
const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage', '.pytest_cache', '__pycache__'];
const IGNORE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.lock', '.json'];

const stats = {
    totalFiles: 0,
    buckets: {
        'Extreme (> 1000 lines)': 0,
        'Very Large (800 - 1000 lines)': 0,
        'Large (500 - 800 lines)': 0,
        'Medium (200 - 500 lines)': 0,
        'Small (< 200 lines)': 0
    },
    largeFilesList: []
};

function countLines(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.split(/\r?\n/).length;
    } catch (err) {
        return 0;
    }
}

function walk(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!IGNORE_DIRS.includes(file)) {
                walk(fullPath);
            }
        } else {
            const ext = path.extname(file).toLowerCase();
            if (!IGNORE_EXTS.includes(ext)) {
                const lines = countLines(fullPath);
                stats.totalFiles++;

                if (lines > 1000) {
                    stats.buckets['Extreme (> 1000 lines)']++;
                    stats.largeFilesList.push({ path: fullPath, lines });
                } else if (lines >= 800) {
                    stats.buckets['Very Large (800 - 1000 lines)']++;
                    stats.largeFilesList.push({ path: fullPath, lines });
                } else if (lines >= 500) {
                    stats.buckets['Large (500 - 800 lines)']++;
                } else if (lines >= 200) {
                    stats.buckets['Medium (200 - 500 lines)']++;
                } else {
                    stats.buckets['Small (< 200 lines)']++;
                }
            }
        }
    }
}

console.log(`\n🔍 Scanning directory: ${TARGET_DIR}...`);
walk(TARGET_DIR);

console.log('\n📊 File Length Distribution:');
console.table(stats.buckets);

if (stats.largeFilesList.length > 0) {
    console.log('\n⚠️ Top Large Files (> 800 lines):');
    stats.largeFilesList
        .sort((a, b) => b.lines - a.lines)
        .forEach(f => console.log(` - ${f.lines.toString().padStart(5)} lines: ${path.relative(TARGET_DIR, f.path)}`));
}

console.log(`\n✅ Total files audited: ${stats.totalFiles}\n`);
