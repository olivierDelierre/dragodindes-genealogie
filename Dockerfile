FROM python:3.13-alpine

# Aucune dépendance : bibliothèque standard uniquement.
WORKDIR /app
COPY server.py index.html app.js data.js style.css brume.css icon.svg icon-32.png apple-touch-icon.png ./
COPY images ./images

# La base SQLite vit dans /data (à monter sur un dataset du NAS pour qu'elle survive aux mises à jour).
ENV HOST=0.0.0.0 PORT=8765 HARAS_DB=/data/haras.db PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8765

# 568 = utilisateur « apps » de TrueNAS : il doit avoir le droit d'écrire dans le dataset monté sur /data.
USER 568:568
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8765/ >/dev/null || exit 1
CMD ["python3", "server.py"]
