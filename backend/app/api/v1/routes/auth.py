import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.auth import (
    Token, LoginRequest, UserCreate, UserResponse,
    ForgotPasswordRequest, ResetPasswordRequest, GitHubTokenUpdate
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

def format_user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        has_github_token=bool(user.github_token and user.github_token.strip()),
        created_at=user.created_at
    )

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email))
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists")

    user = User(
        email=payload.email,
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name or payload.email.split("@")[0].title(),
        role=payload.role or "ENGINEER"
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return format_user_response(user)

@router.post("/login", response_model=Token)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(subject=user.email)
    return Token(access_token=access_token, token_type="bearer")

@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    return format_user_response(current_user)

@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if not user:
        # Don't leak user existence in production, but provide clean response
        return {"message": "If that email exists in our system, a password reset link/token has been generated.", "reset_token": None}
    
    reset_token = str(uuid.uuid4())[:8].upper()
    user.reset_token = reset_token
    user.reset_token_expires = datetime.utcnow() + timedelta(minutes=30)
    await db.commit()
    
    return {
        "message": f"Reset token generated for {user.email}",
        "reset_token": reset_token
    }

@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if not user or not user.reset_token:
        raise HTTPException(status_code=400, detail="Invalid password reset request")
    
    if user.reset_token.upper() != payload.reset_token.upper():
        raise HTTPException(status_code=400, detail="Invalid or incorrect reset token")
    
    if user.reset_token_expires and user.reset_token_expires < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Reset token has expired")
    
    user.hashed_password = get_password_hash(payload.new_password)
    user.reset_token = None
    user.reset_token_expires = None
    await db.commit()
    
    return {"message": "Password updated successfully. You may now log in with your new password."}

@router.put("/github-token", response_model=UserResponse)
async def update_github_token(
    payload: GitHubTokenUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    current_user.github_token = payload.github_token.strip()
    await db.commit()
    await db.refresh(current_user)
    return format_user_response(current_user)

@router.delete("/github-token", response_model=UserResponse)
async def disconnect_github_token(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    current_user.github_token = None
    await db.commit()
    await db.refresh(current_user)
    return format_user_response(current_user)

