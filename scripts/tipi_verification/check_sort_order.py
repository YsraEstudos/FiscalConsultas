
def check_sort():
    # Simulate DB content
    items = [
        "84.13",
        "84.14",
        "8413.11.00",
        "8413.90.00",
        "84.15"
    ]
    
    print("--- Ordem ASCII (Atual DB) ---")
    sorted_items = sorted(items)
    for i in sorted_items:
        print(i)
        
    print("\n--- Ordem 'Clean' (Desejada) ---")
    # Limpa pontos para ordenar
    sorted_clean = sorted(items, key=lambda x: x.replace(".", "").ljust(10, '0'))
    for i in sorted_clean:
        print(i)

if __name__ == "__main__":
    check_sort()
