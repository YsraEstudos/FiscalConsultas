import re

html = '<div id="test1" class="foo"></div><span id="test2"></span><p id=test3 class="bar">' * 1000
commented_anchor_keys = [f"test{i}" for i in range(3000) if i % 2 == 0]

def inject_comment_marks_opt_safe(html: str, commented_anchor_keys: list[str]) -> str:
    if not commented_anchor_keys or not html:
        return html

    target_keys = set(commented_anchor_keys)
    class_attr_pattern = re.compile(
        r'(?<![\w-])(class=["\'])([^"\']*)(["\'])'
    )  # NOSONAR

    def _replacer(match: re.Match[str]) -> str:
        found_id = match.group(1) or match.group(2) or match.group(3)
        if found_id not in target_keys:
            return match.group(0)

        target_keys.remove(found_id)

        tag = match.group(0)
        if class_attr_pattern.search(tag):
            tag = class_attr_pattern.sub(
                lambda m: f"{m.group(1)}{m.group(2)} has-comment{m.group(3)}",
                tag,
                count=1,
            )
        else:
            tag = re.sub(r"(\s*/?>)$", ' class="has-comment"\\1', tag)
        return tag

    return re.sub(
        r'<[a-zA-Z][^\s>]*\s+(?:[^\s>]+(?:\s+[^\s>]+)*\s+)?id=(?:"([^"]*)"|\'([^\']*)\'|([^\s/>]+))(?=[\s/>]|$)[^>]*>',  # NOSONAR
        _replacer,
        html,
    )

import time
start = time.time()
out_opt = inject_comment_marks_opt_safe(html, commented_anchor_keys)
print(f"New: {time.time() - start:.3f}s")
