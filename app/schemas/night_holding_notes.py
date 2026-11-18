from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class HoldingNotePut(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    text: str

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        note = value.strip()
        if not 1 <= len(note) <= 2000 or "\x00" in note:
            raise ValueError("Enter 1 to 2,000 Unicode characters.")
        try:
            note.encode("utf-8")
        except UnicodeEncodeError:
            raise ValueError("Enter valid Unicode text.") from None
        return note


class Note(BaseModel):
    text: str
    updated_at: datetime


class HoldingNote(BaseModel):
    symbol: str
    note: Note | None
