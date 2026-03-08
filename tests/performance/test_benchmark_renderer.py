import re

import pytest

from backend.presentation.renderer import HtmlRenderer, _get_fallback_anchor_pattern


def _build_renderer_fixture(
    num_codes: int = 80,
) -> tuple[str, list[dict[str, str]], str]:
    posicoes = [{"codigo": f"{i:02d}.{i % 100:02d}"} for i in range(1, num_codes + 1)]
    content = "\n".join(
        f'{pos["codigo"]} - Descricao {idx}<span id="other-{idx}"></span>'
        for idx, pos in enumerate(posicoes, start=1)
    )
    return content, posicoes, "84"


def _inject_with_uncached_regex(content: str, posicoes: list[dict[str, str]]) -> str:
    existing_ids = set(re.findall(r'id="(pos-[^"]+)"', content))
    pending = HtmlRenderer._get_pending_anchors(posicoes, existing_ids)
    if not pending:
        return content

    code_to_anchor = dict(pending)
    escaped_codes = "|".join(re.escape(pos_code) for pos_code in code_to_anchor)
    pattern = re.compile(
        rf"^\s*(?:\*\*|\*)?(?P<code>{escaped_codes})(?:\*\*|\*)?\s*(?:[-\u2013\u2014:])\s*",
        re.MULTILINE,
    )
    injected: set[str] = set()

    def _anchor_replacer(match: re.Match) -> str:
        code = match.group("code")
        if code in injected:
            return match.group(0)
        anchor_id = code_to_anchor.get(code)
        if not anchor_id:
            return match.group(0)
        injected.add(code)
        return (
            f'<span id="{anchor_id}" class="ncm-target ncm-position-title">'
            f"{match.group(0)}</span>"
        )

    return pattern.sub(_anchor_replacer, content)


@pytest.mark.benchmark(group="renderer_fallback_anchors")
def test_bench_renderer_fallback_anchor_injection_cached(benchmark):
    content, posicoes, chapter_num = _build_renderer_fixture()

    # Warm the cache so the benchmark isolates the steady-state path.
    pending = HtmlRenderer._get_pending_anchors(posicoes, set())
    _get_fallback_anchor_pattern(tuple(dict(pending).keys()))

    def run_injection():
        rendered = HtmlRenderer._inject_fallback_anchors(content, posicoes, chapter_num)
        assert rendered.count('class="ncm-target ncm-position-title"') == len(posicoes)

    benchmark(run_injection)


@pytest.mark.benchmark(group="renderer_fallback_anchors")
def test_bench_renderer_fallback_anchor_injection_uncached_baseline(benchmark):
    content, posicoes, _ = _build_renderer_fixture()

    def run_injection():
        rendered = _inject_with_uncached_regex(content, posicoes)
        assert rendered.count('class="ncm-target ncm-position-title"') == len(posicoes)

    benchmark(run_injection)
