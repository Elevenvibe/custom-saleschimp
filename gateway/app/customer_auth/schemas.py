from pydantic import BaseModel, EmailStr, Field


class SignupIn(BaseModel):
    """Extended signup form: in addition to the basics, we capture marketing
    fields that help with onboarding and segmentation."""

    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1, max_length=128)
    company_name: str = Field(min_length=1, max_length=128)

    company_size: str | None = Field(default=None, max_length=32)
    role_title: str | None = Field(default=None, max_length=64)
    phone: str | None = Field(default=None, max_length=32)
    use_case: str | None = Field(default=None, max_length=512)
    expected_call_volume: str | None = Field(default=None, max_length=32)
    referral_source: str | None = Field(default=None, max_length=64)


class SignupOut(BaseModel):
    tenant_id: int
    status: str
    message: str


class VerifyOut(BaseModel):
    tenant_id: int
    dograh_org_id: int
    dograh_user_id: int
    access_token: str
    expires_in: int
    role: str
    redirect: str
