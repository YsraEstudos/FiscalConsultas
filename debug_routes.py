import sys
import os
import asyncio

# Add project root to path
sys.path.insert(0, os.getcwd())

from backend.server.app import app


def print_routes():
    print("Registered Routes:")
    for route in app.routes:
        methods = ", ".join(route.methods) if hasattr(route, "methods") else "None"
        print(f"  {getattr(route, 'path', 'No Path')} [{methods}]")


if __name__ == "__main__":
    print_routes()
