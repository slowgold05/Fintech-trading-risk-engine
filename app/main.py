from fastapi import FastAPI

from app.routers import auth, assets, trades, portfolio, risk

app = FastAPI(
    title="Fintech Trading & Risk Engine",
    version="1.0.0",
    description="Secure backend for trading, portfolio analytics, and risk assessment",
)

# Root / health endpoint
@app.get("/")
def root():
    return {
        "name": "Fintech Trading & Risk Engine",
        "docs": "/docs",
        "openapi": "/openapi.json",
        "status": "running",
    }

# Register routers
app.include_router(auth.router, prefix="/auth", tags=["Auth"])
app.include_router(trades.router, prefix="/trades", tags=["Trades"])
app.include_router(portfolio.router, prefix="/portfolio", tags=["Portfolio"])
app.include_router(risk.router, prefix="/risk", tags=["Risk"])
app.include_router(assets.router, prefix="/assets", tags=["Assets"])
