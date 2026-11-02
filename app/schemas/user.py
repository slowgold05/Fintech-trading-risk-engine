from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        lowered = value.lower()
        if lowered in {"password", "qwerty123", "letmein123"}:
            raise ValueError("Password is too common")

        categories = sum(
            [
                any(char.islower() for char in value),
                any(char.isupper() for char in value),
                any(char.isdigit() for char in value),
                any(not char.isalnum() for char in value),
            ]
        )
        if categories < 2:
            raise ValueError("Password must use at least two character types")

        return value

    @field_validator("password")
    @classmethod
    def password_not_repetitive(cls, value: str) -> str:
        if len(set(value)) <= 2:
            raise ValueError("Password is too repetitive")
        return value

    @model_validator(mode="after")
    def password_not_email_derived(self) -> "UserCreate":
        local_part = str(self.email).split("@", 1)[0].lower()
        if len(local_part) >= 3 and local_part in self.password.lower():
            raise ValueError("Password must not contain your email name")
        return self


class UserOut(BaseModel):
    id: int
    email: EmailStr
    role: str

    class Config:
        from_attributes = True
