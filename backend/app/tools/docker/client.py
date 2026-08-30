from typing import Optional, Any
import logging

logger = logging.getLogger(__name__)

try:
    import docker
    DOCKER_AVAILABLE = True
except ImportError:
    docker = None
    DOCKER_AVAILABLE = False
    logger.warning("Docker SDK module not installed. Falling back to HTTP/Mock Docker driver.")

class DockerClientWrapper:
    def __init__(self):
        self._client: Optional[Any] = None
        if DOCKER_AVAILABLE:
            try:
                self._client = docker.from_env()
            except Exception as ex:
                logger.warning(f"Could not connect to Docker daemon: {ex}. Falling back to mock driver.")

    def is_available(self) -> bool:
        return self._client is not None

    def get_client(self):
        if not self._client:
            raise ValueError("Docker SDK client is not connected to daemon.")
        return self._client

docker_wrapper = DockerClientWrapper()
