from pydantic import BaseModel, EmailStr


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    # Optional 2FA code (TOTP or email). Absent on the first step.
    code: str | None = None


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    role: str


class LoginResultOut(BaseModel):
    """Either a 2FA challenge (no token) or the issued token."""

    requires_2fa: bool = False
    methods: list[str] = []
    access_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    role: str | None = None
