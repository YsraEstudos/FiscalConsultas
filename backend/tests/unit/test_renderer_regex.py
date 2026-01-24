import re
import unittest
from backend.presentation.renderer import HtmlRenderer, _get_position_pattern

class TestRendererRegex(unittest.TestCase):
    def test_get_position_pattern_standard(self):
        """Test standard format: **84.09** - Description"""
        pattern = _get_position_pattern("84.09")
        text = "**84.09** - Parts suitable for use solely or principally..."
        match = pattern.search(text)
        self.assertIsNotNone(match, "Should match standard bolded format")

    def test_get_position_pattern_no_bold(self):
        """Test format without bold: 84.09 - Description"""
        pattern = _get_position_pattern("84.09")
        text = "84.09 - Parts suitable for use solely or principally..."
        match = pattern.search(text)
        self.assertIsNotNone(match, "Should match non-bolded format (PROPOSED FIX)")

    def test_get_position_pattern_colon_separator(self):
        """Test format with colon: 84.09: Description"""
        pattern = _get_position_pattern("84.09")
        text = "84.09: Parts suitable for use solely or principally..."
        match = pattern.search(text)
        self.assertIsNotNone(match, "Should match colon separator (PROPOSED FIX)")

    def test_get_position_pattern_spacing(self):
        """Test format with extra spacing"""
        pattern = _get_position_pattern("84.09")
        text = "  84.09   Description"
        match = pattern.search(text)
        self.assertIsNotNone(match, "Should match with extra spacing (PROPOSED FIX)")
    
    def test_render_chapter_injection(self):
        """Test full render cycle injection"""
        mock_data = {
            "capitulo": "84",
            "conteudo": "84.09 - Parts suitable.\n\nSome text.",
            "posicoes": [{"codigo": "84.09", "descricao": "Parts"}],
            "real_content_found": True
        }
        
        # This simulates what happens in render_chapter fallback loop
        content = mock_data["conteudo"]
        pos_code = "84.09"
        anchor_id = "pos-84-09"
        
        # Manually replicate the substitution logic from renderer.py to test regex effectiveness
        pattern = _get_position_pattern(pos_code)
        
        # Attempt substitution
        new_content = pattern.sub(
            lambda m: f'<span id="{anchor_id}" class="ncm-target"></span>{m.group(0)}',
            content,
            count=1
        )
        
        self.assertIn(f'id="{anchor_id}"', new_content, "Should inject anchor ID into content")

if __name__ == '__main__':
    unittest.main()
