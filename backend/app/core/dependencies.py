from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_token(token)
    if payload is None:
        raise credentials_exception
    
    email: str = payload.get("sub")
    if email is None:
        raise credentials_exception
    
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exception
    return user

async def get_current_user_optional(token: str | None = Depends(oauth2_scheme_optional), db: AsyncSession = Depends(get_db)) -> User:
    if token:
        payload = decode_token(token)
        if payload and payload.get("sub"):
            email = payload.get("sub")
            result = await db.execute(select(User).where(User.email == email))
            user = result.scalar_one_or_none()
            if user and user.is_active:
                return user
    
    # Fallback to first user in database
    result = await db.execute(select(User).limit(1))
    user = result.scalar_one_or_none()
    if user:
        return user
    return User(id=1, email="engineer@devops-agent.local", full_name="Local Engineer", role="ENGINEER")

def require_roles(allowed_roles: list[str]):
    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"User role '{current_user.role}' is not authorized for this operation",
            )
        return current_user
    return role_checker
