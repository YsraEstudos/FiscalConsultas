from backend.presentation.renderer import inject_comment_marks


def test_inject_comment_marks_empty_inputs():
    assert inject_comment_marks("", ["key1"]) == ""
    assert inject_comment_marks("<div></div>", []) == "<div></div>"


def test_inject_comment_marks_single_target():
    html = '<div id="target1">Content</div>'
    expected = '<div id="target1" class="has-comment">Content</div>'
    assert inject_comment_marks(html, ["target1"]) == expected


def test_inject_comment_marks_with_existing_class():
    html = '<div id="target1" class="my-class">Content</div>'
    expected = '<div id="target1" class="my-class has-comment">Content</div>'
    assert inject_comment_marks(html, ["target1"]) == expected


def test_inject_comment_marks_multiple_targets():
    html = """
    <div id="target1">Content 1</div>
    <span id="ignore">Content 2</span>
    <p id="target2" class="text-bold">Content 3</p>
    """
    expected = """
    <div id="target1" class="has-comment">Content 1</div>
    <span id="ignore">Content 2</span>
    <p id="target2" class="text-bold has-comment">Content 3</p>
    """
    assert inject_comment_marks(html, ["target1", "target2"]) == expected


def test_inject_comment_marks_single_quotes():
    html = "<div id='target1' class='my-class'>Content</div>"
    expected = "<div id='target1' class='my-class has-comment'>Content</div>"
    assert inject_comment_marks(html, ["target1"]) == expected


def test_inject_comment_marks_no_quotes():
    # Note: If there's an unquoted class attribute, the current regex might not append inside the class string as elegantly,
    # but based on the codebase, we usually have quoted class attributes.
    # We still check that it correctly injects `has-comment` if there are no classes or adds it robustly.
    html_no_class = "<div id=target1>Content</div>"
    expected_no_class = '<div id=target1 class="has-comment">Content</div>'
    assert inject_comment_marks(html_no_class, ["target1"]) == expected_no_class


def test_inject_comment_marks_with_other_attributes():
    html = '<img src="image.png" id="target1" alt="Test"/>'
    expected = '<img src="image.png" id="target1" alt="Test" class="has-comment"/>'
    assert inject_comment_marks(html, ["target1"]) == expected


def test_inject_comment_marks_not_found():
    html = '<div id="other">Content</div>'
    assert inject_comment_marks(html, ["target1"]) == html
