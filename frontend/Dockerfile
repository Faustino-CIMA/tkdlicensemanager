FROM node:20-alpine

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --chown=app:app package.json package-lock.json /app/
RUN npm ci

COPY --chown=app:app . /app

RUN npm run build && chown -R app:app /app

EXPOSE 3000

USER app
