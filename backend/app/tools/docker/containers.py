from typing import List, Dict, Any
from app.tools.docker.client import docker_wrapper

def list_containers() -> List[Dict[str, Any]]:
    """List containers and their statuses."""
    if not docker_wrapper.is_available():
        return [
            {
                "id": "c1a93b01",
                "name": "checkout-api",
                "status": "degraded",
                "image": "acme/checkout-api:v1.2",
                "exit_code": 1,
                "restart_count": 2
            },
            {
                "id": "d8e21f44",
                "name": "tax-service",
                "status": "running",
                "image": "acme/tax-service:v1.0",
                "exit_code": 0,
                "restart_count": 0
            }
        ]

    client = docker_wrapper.get_client()
    containers = client.containers.list(all=True)
    results = []
    for c in containers:
        results.append({
            "id": c.short_id,
            "name": c.name,
            "status": c.status,
            "image": c.image.tags[0] if c.image.tags else c.image.short_id,
            "exit_code": c.attrs.get("State", {}).get("ExitCode", 0)
        })
    return results

def get_container_status(container_name: str) -> Dict[str, Any]:
    """Retrieve detailed status for a specific container."""
    if not docker_wrapper.is_available():
        return {
            "name": container_name,
            "status": "exited",
            "exit_code": 1,
            "restart_count": 3,
            "health": "unhealthy",
            "error": "TypeError: Cannot read property 'zipCode' of undefined"
        }

    client = docker_wrapper.get_client()
    container = client.containers.get(container_name)
    return {
        "id": container.short_id,
        "name": container.name,
        "status": container.status,
        "exit_code": container.attrs.get("State", {}).get("ExitCode", 0),
        "health": container.attrs.get("State", {}).get("Health", {}).get("Status", "unknown")
    }

def get_container_logs(container_name: str, tail: int = 50) -> str:
    """Retrieve logs from container stdio/stderr."""
    if not docker_wrapper.is_available():
        return (
            f"2026-08-23T12:06:12Z ERROR [{container_name}] TypeError: Cannot read property 'zipCode' of undefined\n"
            f"2026-08-23T12:06:12Z ERROR [{container_name}]     at calculateTax (src/tax/calculate.ts:13:23)\n"
            f"2026-08-23T12:06:13Z ERROR Process exited with code 1"
        )

    client = docker_wrapper.get_client()
    container = client.containers.get(container_name)
    logs_bytes = container.logs(tail=tail)
    return logs_bytes.decode('utf-8', errors='ignore')
