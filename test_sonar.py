import re
_RE_MARKDOWN_BOLD_EDGE = re.compile(r"(?:^\*\*)|(?:\*\*$)")
_RE_MARKDOWN_ITALIC_EDGE = re.compile(r"(?:^\*)|(?:\*$)")
