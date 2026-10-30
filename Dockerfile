FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 app

COPY app app
COPY alembic alembic
COPY alembic.ini .
COPY grc/controls grc/controls
COPY grc/risk_register.yaml grc/risk_register.yaml
RUN mkdir -p grc/evidence && chown -R app:app /app

USER app
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
