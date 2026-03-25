import re
import timeit

def inject_comment_marks_original(html: str, commented_anchor_keys: list[str]) -> str:
    if not commented_anchor_keys or not html:
        return html

    for key in commented_anchor_keys:
        safe_key = re.escape(key)

        def _add_class(match: re.Match) -> str:
            tag = match.group(0)
            if "class=" in tag:
                tag = re.sub(
                    r'(class=["\'])([^"\']*?)(["\'])',
                    lambda m: f"{m.group(1)}{m.group(2)} has-comment{m.group(3)}",
                    tag,
                    count=1,
                )
            else:
                tag = re.sub(r"(\s*/?>)$", ' class="has-comment"\\1', tag)
            return tag

        html = re.sub(
            rf'<[a-zA-Z][^>]*\bid=["\']?{safe_key}["\']?[^>]*>',
            _add_class,
            html,
            count=1,
        )

    return html

_CLASS_ATTR_RE = re.compile(r'(class=["\'])([^"\']*)(["\'])')
_CLOSE_TAG_RE = re.compile(r"(\s*/?>)$")
_ID_ATTR_RE = re.compile(r'\bid=["\']([^"\']+)["\']')
_ANY_TAG_RE = re.compile(r'<[a-zA-Z][^>]*>')

def inject_comment_marks_opt2(html: str, commented_anchor_keys: list[str]) -> str:
    if not commented_anchor_keys or not html:
        return html

    keys_set = set(commented_anchor_keys)

    def _process_tag(match: re.Match) -> str:
        tag = match.group(0)

        # Check if the tag has an id attribute at all
        if 'id=' not in tag:
            return tag

        id_match = _ID_ATTR_RE.search(tag)
        if not id_match:
            return tag

        if id_match.group(1) not in keys_set:
            return tag

        if "class=" in tag:
            # Adiciona has-comment à class existente
            tag = _CLASS_ATTR_RE.sub(
                lambda m: f"{m.group(1)}{m.group(2)} has-comment{m.group(3)}",
                tag,
                count=1,
            )
        else:
            # Insere class antes do fechamento da tag de abertura
            tag = _CLOSE_TAG_RE.sub(' class="has-comment"\\1', tag)
        return tag

    return _ANY_TAG_RE.sub(_process_tag, html)

# Generate a large HTML document
html = ""
keys = []
for i in range(1000):
    html += f'<div id="pos-{i}" class="item">Content {i}</div>\n'
    if i % 10 == 0:
        keys.append(f"pos-{i}")

print("Original:")
print(timeit.timeit(lambda: inject_comment_marks_original(html, keys), number=100))

print("Opt2:")
print(timeit.timeit(lambda: inject_comment_marks_opt2(html, keys), number=100))
