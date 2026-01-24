import unittest
from backend.presentation.renderer import HtmlRenderer

class TestRendererStructure(unittest.TestCase):
    def test_render_chapter_structure_non_bold(self):
        """Test that non-bold headings are converted to h3 headings with id"""
        mock_data = {
            "capitulo": "84",
            "conteudo": "84.09 - Parts suitable for use.\n\nDescription text.",
            "posicoes": [{"codigo": "84.09", "descricao": "Parts"}],
            "real_content_found": True
        }
        
        html = HtmlRenderer.render_chapter(mock_data)
        
        # Check for heading structure
        self.assertIn("<h3 class=\"nesh-section\" id=\"pos-84-09\">", html, "Should create <h3> heading")
        self.assertNotIn("<details", html, "Should not include <details>")
        self.assertNotIn("<summary", html, "Should not include <summary>")
        
        # Check that ID was generated on the wrapper div
        self.assertIn('id="pos-84-09"', html, "Should have injected anchor ID")
        
        # Check that code is wrapped in smart link (since inject_smart_links runs after structure)
        # Note: The exact class/attrs might change, but we expect the A tag
        self.assertIn('<a href="#" class="smart-link" data-ncm="8409">84.09</a>', html, "Summary code should be smart-linked")

if __name__ == '__main__':
    unittest.main()
