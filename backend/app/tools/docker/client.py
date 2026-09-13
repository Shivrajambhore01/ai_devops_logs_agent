from typing import Optional, Any
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    import docker
    DOCKER_AVAILABLE = True
except ImportError:
    docker = None
    DOCKER_AVAILABLE = False
    logger.warning("Docker SDK module not installed.")

class DockerClientWrapper:
    def __init__(self):
        self._client: Optional[Any] = None
        self._try_connect()

    def _try_connect(self) -> bool:
        if not DOCKER_AVAILABLE:
            return False
        try:
            self._client = docker.from_env()
            self._client.ping()
            return True
        except Exception as ex:
            logger.debug(f"Docker daemon connection attempt: {ex}")
            self._client = None
            return False

    def is_available(self) -> bool:
        if self._client is None:
            self._try_connect()
        else:
            try:
                self._client.ping()
            except Exception:
                self._client = None
        return self._client is not None

    def is_mock_allowed(self) -> bool:
        """Mock fallback is strictly disabled — 100% real working Docker only."""
        return False

    def get_client(self):
        if not self.is_available():
            raise ValueError("Docker SDK client is not connected to daemon.")
        return self._client

docker_wrapper = DockerClientWrapper()
