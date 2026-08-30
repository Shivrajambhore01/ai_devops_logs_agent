import unittest
import asyncio
from app.terminal.error_detector import ErrorDetector, _normalize_error
from app.terminal.event import NormalizedError, LogLevel
from app.ai.error_analyzer import _expert_rule_diagnosis, analyze_error_async

class TestDockerErrorIntelligence(unittest.TestCase):
    def test_normalize_bcrypt_attribute_error(self):
        raw = """Traceback (most recent call last):
  File "/usr/local/lib/python3.11/site-packages/passlib/handlers/bcrypt.py", line 24, in <module>
    version = _bcrypt.__about__.__version__
AttributeError: module 'bcrypt' has no attribute '__about__'"""
        norm = _normalize_error(raw, "session_test")
        self.assertEqual(norm.language, "python")
        self.assertEqual(norm.error_type, "AttributeError")
        self.assertEqual(norm.error_message, "module 'bcrypt' has no attribute '__about__'")
        self.assertEqual(norm.line_number, 24)
        self.assertIn("bcrypt.py", norm.file_path)

    def test_expert_rule_diagnosis_bcrypt(self):
        norm = NormalizedError(
            id="err_123",
            session_id="docker_test",
            language="python",
            error_type="AttributeError",
            error_message="module 'bcrypt' has no attribute '__about__'",
            file_path="/usr/local/lib/python3.11/site-packages/passlib/handlers/bcrypt.py",
            line_number=24,
            raw_stack_trace="AttributeError: module 'bcrypt' has no attribute '__about__'",
            severity="HIGH",
        )
        diag = _expert_rule_diagnosis(norm, "docker_test")
        self.assertIsNotNone(diag)
        self.assertIn("Bcrypt", diag.title)
        self.assertIn("Passlib", diag.title)
        self.assertTrue(diag.confidence >= 0.95)
        self.assertTrue(any("bcrypt<4.0.0" in cmd for cmd in diag.suggested_commands))

    def test_expert_rule_diagnosis_module_missing(self):
        norm = NormalizedError(
            id="err_456",
            session_id="docker_test",
            language="python",
            error_type="ModuleNotFoundError",
            error_message="No module named 'asyncpg'",
            file_path="app/core/database.py",
            line_number=5,
            raw_stack_trace="ModuleNotFoundError: No module named 'asyncpg'",
            severity="HIGH",
        )
        diag = _expert_rule_diagnosis(norm, "docker_test")
        self.assertIsNotNone(diag)
        self.assertIn("asyncpg", diag.title)
        self.assertTrue(any("pip install asyncpg" in cmd for cmd in diag.suggested_commands))

    def test_expert_rule_diagnosis_connection_refused(self):
        norm = NormalizedError(
            id="err_789",
            session_id="docker_test",
            language="python",
            error_type="ConnectionRefusedError",
            error_message="[Errno 111] Connection refused connecting to 127.0.0.1:5432",
            file_path="app/core/database.py",
            line_number=10,
            raw_stack_trace="ConnectionRefusedError: [Errno 111] Connection refused",
            severity="CRITICAL",
        )
        diag = _expert_rule_diagnosis(norm, "docker_test")
        self.assertIsNotNone(diag)
        self.assertIn("PostgreSQL", diag.title)
        self.assertEqual(diag.severity, "CRITICAL")

    def test_error_detector_flushing(self):
        flushed_errors = []

        async def on_error(err):
            flushed_errors.append(err)

        detector = ErrorDetector("test_session", on_error)

        async def run_feed():
            # Feed Python traceback
            await detector.feed_line("Traceback (most recent call last):")
            await detector.feed_line('  File "/app/main.py", line 12, in <module>')
            await detector.feed_line('    import bcrypt')
            await detector.feed_line("AttributeError: module 'bcrypt' has no attribute '__about__'")
            # Feed normal unindented line (HTTP 200 health check) -> triggers instant flush
            await detector.feed_line('INFO: 127.0.0.1:43060 - "GET /health HTTP/1.1" 200 OK')

        asyncio.run(run_feed())
        self.assertEqual(len(flushed_errors), 1)
        self.assertEqual(flushed_errors[0].error_type, "AttributeError")

if __name__ == '__main__':
    unittest.main()
