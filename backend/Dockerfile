FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies + useful debugging tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gettext \
    curl \
    libcairo2 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi8 \
    shared-mime-info \
    fonts-dejavu \
    procps \
    net-tools \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --system app \
    && useradd --system --gid app --create-home app \
    && mkdir -p /var/www/staticfiles /var/lib/celerybeat \
    && chown -R app:app /var/www/staticfiles /var/lib/celerybeat

# Install Python dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy application code
COPY --chown=app:app . /app

EXPOSE 8000

USER app

# Default process when the image is run without a Compose `command:` override.
# Always bind 0.0.0.0 so reverse proxies on the Docker network can reach the app.
CMD ["gunicorn", "-c", "gunicorn.conf.py", "config.wsgi:application"]
