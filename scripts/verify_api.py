
import subprocess
import sys
import os

def main():
    print("🚀 Iniciando Verificação da API...")
    
    # Path to tests
    test_path = os.path.join("backend", "tests", "integration", "test_api_routes.py")
    
    if not os.path.exists(test_path):
        print(f"❌ Erro: Arquivo de teste não encontrado: {test_path}")
        sys.exit(1)
        
    print(f"📂 Executando testes em: {test_path}")
    print("-" * 50)
    
    # Run pytest
    # -v: verbose
    # --tb=short: shorter traceback format
    # -p no:warnings: disable warnings output to keep it clean
    result = subprocess.run(
        [sys.executable, "-m", "pytest", test_path, "-v", "--tb=short"], 
        cwd=os.getcwd(),
        capture_output=False
    )
    
    print("-" * 50)
    if result.returncode == 0:
        print("✅ TODOS OS TESTES PASSARAM! A API está íntegra.")
    else:
        print("❌ ALGUNS TESTES FALHARAM. Verifique os erros acima.")
        print("💡 Dica: Verifique se existe alguma discrepância de configuração ou erros de importação.")
        
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
