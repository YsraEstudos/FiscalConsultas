import re
import sys


def test_js_import_pattern():
    print("Testing JS_IMPORT_PATTERN...")
    # The buggy pattern: r"^\s*import\s+|\brequire\("
    # The fixed pattern: r"^\s*(?:export\s+)?(?:import\s+|\brequire\()"

    # We want to test the FIXED one
    pattern = re.compile(r"^\s*(?:export\s+)?(?:import\s+|\brequire\()")

    test_cases = [
        ("import { x } from 'y'", True, "Standard import"),
        ("  import defaultExport from 'module'", True, "Indented import"),
        ("const x = require('path')", False, "Module require NOT at start"),
        ("require('fs')", True, "Direct require"),
        ("  require('fs')", True, "Indented require"),
        ("export import { x } from 'y'", True, "Exported import"),
        ("// TODO: we might require('db') later", False, "Require in comment"),
        ("console.log('require(inside string)')", False, "Require in string"),
        ("const require = 5;", False, "Constant named require"),
    ]

    success = True
    for text, expected, desc in test_cases:
        match = bool(pattern.match(text))
        if match == expected:
            print(f"✅ [PASS] {desc}: '{text}'")
        else:
            print(f"❌ [FAIL] {desc}: '{text}' (Expected {expected}, got {match})")
            # If it failed, let's see what the buggy pattern would have done
            buggy = re.compile(r"(?:^\s*import\s+)|(?:\brequire\()")
            buggy_match = bool(buggy.match(text))
            print(f"   (Buggy pattern would have returned: {buggy_match})")
            success = False

    return success


if __name__ == "__main__":
    if test_js_import_pattern():
        print("\n✨ All tests passed!")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed.")
        sys.exit(1)
