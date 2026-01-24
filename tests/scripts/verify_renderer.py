from backend.presentation.tipi_renderer import TipiRenderer

def verify_renderer():
    print("=== Verification: Renderer Output for Mixed Levels ===")
    
    mock_positions = [
        {'ncm': '84.13', 'codigo':'84.13', 'descricao': 'Heading', 'aliquota': '', 'nivel': 1},
        {'ncm': '8413.1', 'codigo':'8413.1', 'descricao': 'Subheading', 'aliquota': '', 'nivel': 2},
        {'ncm': '8413.11.00', 'codigo':'8413.11.00', 'descricao': 'Item', 'aliquota': '5', 'nivel': 4},
        {'ncm': '8413.91.00', 'codigo':'8413.91.00', 'descricao': 'Item NT', 'aliquota': 'NT', 'nivel': 4},
    ]
    
    chapter = {
        'capitulo': '84',
        'titulo': 'Capitulo 84',
        'posicoes': mock_positions
    }
    
    html = TipiRenderer.render_chapter(chapter)
    
    # Simple checks
    if 'tipi-nivel-1' in html and 'tipi-nivel-2' in html and 'tipi-nivel-4' in html:
        print("PASS: Indentation classes found.")
    else:
        print("FAIL: Missing indentation classes.")
        
    if '5%' in html:
        print("PASS: Aliquot 5% rendered.")
    else:
         print("FAIL: Aliquot 5% missing.")
         
    # Check for empty aliquot on 84.13
    # We expect span class... ></span> or >0%</span>?
    # Logic changed to empty string.
    # <span class="tipi-aliquota ..."></span>
    
    print("\n--- HTML Snippet ---")
    print(html)

if __name__ == "__main__":
    verify_renderer()
