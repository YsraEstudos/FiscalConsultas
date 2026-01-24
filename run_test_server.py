#!/usr/bin/env python3
"""
Test Server - Port 8001
"""
import uvicorn
import os
import sys
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

def main():
    # Adiciona diretório atual ao path para garantir imports corretos
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    
    # Configurações do servidor - PORTA ALTERNATIVA
    HOST = "127.0.0.1"
    PORT = 8001
    
    print(f"Starting TEST Server on http://{HOST}:{PORT}")
    
    uvicorn.run("backend.server.app:app", host=HOST, port=PORT, reload=True)

if __name__ == "__main__":
    main()
