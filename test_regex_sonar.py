import re

old_re = re.compile(r'<[a-zA-Z][^>]*\bid=(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))[^>]*>')
new_re = re.compile(r'<[a-zA-Z][^\s>]*\s+[^>]*id=(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))[^>]*>')

htmls = [
    '<div id="foo">',
    '<span class="bar" id=\'baz\'>',
    '<p id=qux>',
    '<divid="invalid">',  # old matched this, new doesn't
]

for html in htmls:
    print(f"HTML: {html}")
    print(f"OLD: {old_re.search(html)}")
    print(f"NEW: {new_re.search(html)}")
    print("---")
