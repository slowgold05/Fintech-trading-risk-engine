from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field, StringConstraints, field_validator, model_validator

from app.schemas.night_notebook import NotebookID, NotebookInput


def _plain_text(value: str) -> str:
    if not value.strip() or "\0" in value:
        raise ValueError("Enter nonblank plain text.")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("Enter valid UTF-8 text.") from None
    return value


def _cursor_range(value: str) -> str:
    if value and int(value) > 2_147_483_647:
        raise ValueError("Invalid journal cursor.")
    return value


Note = Annotated[str, StringConstraints(min_length=1, max_length=2000), AfterValidator(_plain_text)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24), AfterValidator(_plain_text)]
Tags = Annotated[list[Tag], Field(max_length=5)]
JournalCursor = Annotated[str, StringConstraints(pattern=r"^(?:[1-9][0-9]{0,9})?$"), AfterValidator(_cursor_range)]


class JournalCreate(NotebookInput):
    order_id: Annotated[NotebookID, Field(strict=True)]
    note: Note
    tags: Tags


class JournalPatch(NotebookInput):
    note: Note | None = None
    tags: Tags | None = None

    @field_validator("note", "tags")
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError("Supply a value or omit this field.")
        return value

    @model_validator(mode="after")
    def require_change(self):
        if not self.model_fields_set:
            raise ValueError("Supply a note, tags, or both.")
        return self


class JournalEntryOut(BaseModel):
    id: int
    order_id: int
    note: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime


class JournalPage(BaseModel):
    items: list[JournalEntryOut]
    next_cursor: str | None
