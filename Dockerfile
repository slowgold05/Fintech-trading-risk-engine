FROM python:3.12-slim

# Apply base-image security patches for APT and zlib.
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade apt zlib1g \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home --uid 10001 app

COPY app app
COPY alembic alembic
COPY alembic.ini .
COPY grc/controls grc/controls
COPY grc/surveillance grc/surveillance
COPY grc/risk_register.yaml grc/risk_register.yaml
COPY grc/asset_inventory.yaml grc/asset_inventory.yaml
COPY grc/aml grc/aml
COPY grc/sanctions/fixture.yaml grc/sanctions/fixture.yaml
COPY grc/kris.yaml grc/kris.yaml
COPY grc/signals/accounts.yaml grc/signals/accounts.yaml
COPY deploy/us-east-2-bundle.pem deploy/us-east-2-bundle.pem
COPY deploy/entrypoint.sh deploy/entrypoint.sh
ENV PGSSLROOTCERT=/app/deploy/us-east-2-bundle.pem
RUN sed -i 's/\r$//' deploy/entrypoint.sh && chmod 755 deploy/entrypoint.sh && mkdir -p grc/evidence && chown -R app:app /app

USER app
EXPOSE 8000
CMD ["sh", "/app/deploy/entrypoint.sh"]
