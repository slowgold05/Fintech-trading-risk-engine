from pydantic import BaseModel, Field


class TradeCreate(BaseModel):
    symbol: str
    asset_type: str  # stock/crypto
    side: str        # buy/sell
    quantity: float = Field(gt=0)


class TradeOut(BaseModel):
    trade_id: int
    risk_score: int
