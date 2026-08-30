import os
from dotenv import load_dotenv
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base

# Load backend/.env or root .env file explicitly
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
root_dir = os.path.abspath(os.path.join(backend_dir, ".."))
backend_env = os.path.join(backend_dir, ".env")
root_env = os.path.join(root_dir, ".env")

target_env = backend_env if os.path.exists(backend_env) else root_env
if os.path.exists(target_env):
    load_dotenv(target_env, override=True)

# Build explicit database connection URL with IPv4 127.0.0.1
db_user = os.getenv("POSTGRES_USER", "postgres")
db_pass = os.getenv("POSTGRES_PASSWORD", "Shivraj@8010")
db_name = os.getenv("POSTGRES_DB", "devops_agent")
db_host = "127.0.0.1"
db_port = os.getenv("POSTGRES_PORT", "5432")

DATABASE_URL = f"postgresql+asyncpg://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"

# Create async SQLAlchemy engine
engine = create_async_engine(
    DATABASE_URL,
    connect_args={"host": "127.0.0.1"},
    echo=False,
    future=True
)

# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

Base = declarative_base()

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
