FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
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
  && groupadd --system app \
  && useradd --system --gid app --create-home app \
  && mkdir -p /var/www/staticfiles \
  && chown -R app:app /var/www/staticfiles \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY --chown=app:app . /app

EXPOSE 8000

USER app
