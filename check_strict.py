import re

pattern = re.compile(r'<[a-zA-Z][^\s>]*\s+(?:[^\s>]+(?:\s+[^\s>]+)*\s+)?id=(?:"([^"]*)"|\'([^\']*)\'|([^\s/>]+))(?=[\s/>]|$)[^>]*>')

cases = [
    '<div id="test">',
    '<div class="foo" id="test">',
    '<div   class="foo"   id="test">',
    '<span data-a="1" data-b="2" id="test">',
    '<img src="a.jpg" id="test" />'
]

for c in cases:
    m = pattern.search(c)
    print(c, "=>", m.group(1) if m else None)
