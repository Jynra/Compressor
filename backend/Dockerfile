# Dockerfile
# Multi-stage build pour optimiser la taille et sécurité

# ===========================================
# Stage 1: Base image avec dépendances système
# ===========================================
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

# Copier les fichiers de configuration des dépendances
COPY package*.json ./

# ===========================================
# Stage 2: Développement
# ===========================================
FROM base AS development

# Installer toutes les dépendances (dev + prod)
RUN npm ci --include=dev

# Copier le code source
COPY . .

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
# Stage 3: Build de production
# ===========================================
FROM base AS builder

# Installer seulement les dépendances de production
RUN npm ci --only=production && npm cache clean --force

# Copier le code source
COPY . .

# Supprimer les fichiers non nécessaires en production
RUN rm -rf \
    tests/ \
    docs/ \
    .git/ \
    .github/ \
    *.md \
    .eslintrc.js \
    .prettierrc \
    docker-compose*.yml \
    Dockerfile*

# ===========================================
# Stage 4: Production finale
# ===========================================
FROM node:18-alpine AS production

# Installer seulement les dépendances système essentielles
RUN apk add --no-cache \
    ffmpeg \
    imagemagick \
    curl \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Créer l'utilisateur non-root
RUN addgroup -g 1001 -S nodejs \
    && adduser -S fileoptimizer -u 1001 -G nodejs

WORKDIR /app

# Copier les fichiers depuis le stage builder
COPY --from=builder --chown=fileoptimizer:nodejs /app ./

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
LABEL maintainer="File Optimizer Team" \
    version="2.0.0" \
    description="Optimiseur de fichiers multimédia" \
    org.opencontainers.image.source="https://github.com/your-username/file-optimizer"

# Point d'entrée avec dumb-init
ENTRYPOINT ["dumb-init", "--"]

# Commande par défaut
CMD ["npm", "start"]

# ===========================================
# Stage 5: Worker spécialisé
# ===========================================
FROM production AS worker

# Le worker utilise la même base mais une commande différente
CMD ["npm", "run", "worker"]

# ===========================================
# .dockerignore suggestions
# ===========================================
# Créer aussi un fichier .dockerignore avec:
#
# node_modules
# npm-debug.log*
# yarn-debug.log*
# yarn-error.log*
# .git
# .gitignore
# .github
# README.md
# docker-compose*.yml
# Dockerfile*
# .env
# .env.local
# .env.*.local
# coverage/
# .nyc_output
# .cache
# uploads/
# logs/
# tmp/
# *.log
# .DS_Store
# Thumbs.db
# tests/
# docs/
# monitoring/
# nginx/