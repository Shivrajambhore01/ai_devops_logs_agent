import asyncio
from sqlalchemy import text
from app.core.database import engine

async def migrate():
    async with engine.begin() as conn:
        # Users table updates
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS github_token VARCHAR(500);"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255);"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP;"))

        # Repositories table user isolation
        await conn.execute(text("ALTER TABLE repositories ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);"))
        await conn.execute(text("UPDATE repositories SET user_id = (SELECT min(id) FROM users) WHERE user_id IS NULL AND (SELECT count(*) FROM users) > 0;"))

        # Incidents table user isolation
        await conn.execute(text("ALTER TABLE incidents ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);"))
        await conn.execute(text("UPDATE incidents SET user_id = (SELECT min(id) FROM users) WHERE user_id IS NULL AND (SELECT count(*) FROM users) > 0;"))

        # Audit logs table user isolation
        await conn.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);"))
        await conn.execute(text("UPDATE audit_logs SET user_id = (SELECT min(id) FROM users) WHERE user_id IS NULL AND (SELECT count(*) FROM users) > 0;"))

        print("PostgreSQL User Data Isolation migration successful!")

if __name__ == "__main__":
    asyncio.run(migrate())

