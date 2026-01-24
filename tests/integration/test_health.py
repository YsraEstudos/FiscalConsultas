
import pytest

def test_status_endpoint(client):
    """
    Verify the /api/status endpoint returns healthy status.
    """
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()
    
    # Check database status
    if data.get("database", {}).get("status") == "error":
        print(f"\nDEBUG DB ERROR: {data['database']}")
    
    assert data.get("status") == "online", f"Status not online. Got: {data}"
    assert data["database"]["status"] != "error", f"Database error: {data.get('database')}"

def test_frontend_fallback(client):
    """
    Verify the root endpoint handles missing frontend build gracefully.
    """
    response = client.get("/")
    assert response.status_code == 200
    # Should return either HTML (if build exists) or the fallback JSON message
    # We don't strictly assert content type here as it depends on build state,
    # but 200 OK means it didn't crash.
