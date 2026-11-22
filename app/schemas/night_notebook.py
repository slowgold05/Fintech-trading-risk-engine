from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer


DecimalText = Annotated[Decimal, PlainSerializer(lambda value: format(value, "f"), return_type=str, when_used="json")]
NotebookID = Annotated[int, Field(gt=0, le=2_147_483_647)]


class NotebookInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
