"""
Gunicorn settings for Docker / reverse-proxy deployments.

Gunicorn 22+ defaults to bind=127.0.0.1:8000. Behind Traefik/Docker, the proxy
connects to the container's non-loopback address → you get HTTP 502 while the
in-container healthcheck (curl localhost) still passes.

Gunicorn 25+ enables a Unix control socket by default; the non-root `app` user
often cannot create it in the working directory → "[Errno 13] Permission denied".
"""
import os

# Listen on all interfaces so Traefik / other containers can reach Gunicorn.
bind = os.environ.get("GUNICORN_BIND", "0.0.0.0:8000")

workers = int(os.environ.get("GUNICORN_WORKERS", "4"))
threads = int(os.environ.get("GUNICORN_THREADS", "2"))
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "120"))

accesslog = "-"
errorlog = "-"

# Disable gunicornc control socket in containers (see Gunicorn 25.1 release notes).
control_socket_disable = True
