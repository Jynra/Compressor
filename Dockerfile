# Dockerfile - Multi-stage build pour Compressor
FROM node:18-alpine AS base

# Installer les dépendances système requises
RUN apk add --no-cache \
    ffmpeg \
    imagemagick \
    curl \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Créer l'utilisateur non-root pour la sécurité
RUN addgroup -g 1001 -S nodejs \
    && adduser -S fileoptimizer -u 1001 -G nodejs

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de configuration des dépendances depuis backend/
COPY backend/package*.json ./

# ===========================================
# Stage 2: Développement
# ===========================================
FROM base AS development

# Installer toutes les dépendances (dev + prod)
RUN npm ci --include=dev

# Copier le code source du backend
COPY backend/ .

# Changer la propriété des fichiers
RUN chown -R fileoptimizer:nodejs /app

# Créer les répertoires nécessaires
RUN mkdir -p /app/uploads /app/logs \
    && chown -R fileoptimizer:nodejs /app/uploads /app/logs

USER fileoptimizer

# Port d'exposition
EXPOSE 8000 9229

# Point d'entrée avec dumb-init pour un arrêt propre
ENTRYPOINT ["dumb-init", "--"]

# Commande par défaut
CMD ["npm", "run", "dev"]

# ===========================================
# Stage 3: Production finale
# ===========================================
FROM base AS production

# Installer seulement les dépendances de production
RUN npm ci --only=production && npm cache clean --force

# Copier le code source du backend
COPY backend/ .

# Supprimer les fichiers non nécessaires en production
RUN rm -rf \
    tests/ \
    docs/ \
    *.md \
    .git*

# Créer les répertoires avec permissions appropriées
RUN mkdir -p /app/uploads /app/logs /app/tmp \
    && chown -R fileoptimizer:nodejs /app/uploads /app/logs /app/tmp \
    && chmod 755 /app/uploads /app/logs /app/tmp

# Variables d'environnement par défaut
ENV NODE_ENV=production \
    PORT=8000 \
    TEMP_DIR=/app/uploads \
    LOG_DIR=/app/logs \
    NPM_CONFIG_CACHE=/app/tmp/.npm

# Passer à l'utilisateur non-root
USER fileoptimizer

# Port d'exposition
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Labels pour la métadonnées
LABEL maintainer="Compressor Team" \
    version="2.0.0" \
    description="Optimiseur de fichiers multimédia" \
    org.opencontainers.image.source="https://github.com/your-username/compressor"

# Point d'entrée avec dumb-init
ENTRYPOINT ["dumb-init", "--"]

# Commande par défaut
CMD ["npm", "start"]