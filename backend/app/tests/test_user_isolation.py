import unittest
from app.tools.github.client import get_github_client

class TestUserIsolation(unittest.TestCase):

    def test_per_user_github_client(self):
        # User 1 token
        client1 = get_github_client("token_user_1")
        self.assertEqual(client1.token, "token_user_1")

        # User 2 token
        client2 = get_github_client("token_user_2")
        self.assertEqual(client2.token, "token_user_2")

        # Unconfigured / empty token defaults gracefully
        client_empty = get_github_client("")
        self.assertIsNotNone(client_empty)

if __name__ == '__main__':
    unittest.main()
