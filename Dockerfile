# Steward — self-hosted, zero npm dependencies. Node 22.5+ is required for
# the built-in node:sqlite module; everything else is Node stdlib.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public

# Data (the SQLite database + uploaded files) lives outside the image so it
# survives rebuilds — mount a volume at /app/data (see docker-compose.yml).
ENV STEWARD_DATA_DIR=/app/data
ENV PORT=8710
ENV HOST=0.0.0.0
VOLUME ["/app/data"]

EXPOSE 8710

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8710)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
