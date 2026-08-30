import unittest
from app.tools.logs.parser import parse_stacktrace, sanitize_log, extract_file_location, extract_error_class
from app.tools.logs.search import search_logs

class TestLogTools(unittest.TestCase):
    def test_sanitize_log(self):
        raw = "INFO User login token: Bearer eyJhbGciOiJIUzI1Ni... secret=my_super_secret_key"
        sanitized = sanitize_log(raw)
        self.assertNotIn("Bearer eyJhbGciOiJIUzI1Ni...", sanitized)
        self.assertNotIn("my_super_secret_key", sanitized)
        self.assertIn("[REDACTED_TOKEN]", sanitized)
        self.assertIn("[REDACTED_SECRET]", sanitized)

    def test_extract_file_location(self):
        log_line = "ERROR TypeError: Cannot read property 'zipCode' of undefined at calculateTax (src/tax/calculate.ts:13:23)"
        loc = extract_file_location(log_line)
        self.assertEqual(loc, "src/tax/calculate.ts:13:23")

    def test_extract_error_class(self):
        log_line = "ERROR MongoServerSelectionError: Server selection timed out after 30000 ms"
        err_type = extract_error_class(log_line)
        self.assertEqual(err_type, "MongoServerSelectionError")

    def test_parse_stacktrace(self):
        raw_log = "2026-08-23T12:06:12Z ERROR [checkout-api] TypeError: Cannot read property 'zipCode' of undefined at calculateTax (src/tax/calculate.ts:13:23)\n2026-08-23T12:06:10Z INFO OK"
        items = parse_stacktrace(raw_log)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["level"], "ERROR")
        self.assertTrue(items[0]["is_stacktrace"])
        self.assertEqual(items[0]["file_location"], "src/tax/calculate.ts:13:23")

    def test_search_logs(self):
        results_err = search_logs("checkout-api", keyword="TypeError", log_level="ERROR")
        self.assertTrue(len(results_err) > 0)
        self.assertEqual(results_err[0]["service"], "checkout-api")
        self.assertEqual(results_err[0]["file_location"], "src/tax/calculate.ts:13:23")

        results_auth = search_logs("auth-middleware", keyword="session", log_level="ERROR")
        self.assertTrue(len(results_auth) > 0)
        self.assertIn("[REDACTED_SECRET]", results_auth[0]["message"])


if __name__ == '__main__':
    unittest.main()
