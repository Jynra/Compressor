# 🗜️ Optimiseur de Fichiers Multimédia

Une solution self-hosted complète pour compresser et optimiser tous vos fichiers multimédia tout en conservant leur format original.

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue.svg)

## 🎯 Objectif

Réduire la taille de vos fichiers multimédia sans changer leur format, avec une interface web moderne et un backend performant utilisant FFmpeg.

## ✨ Fonctionnalités

### 📸 Images
- **Formats supportés** : JPEG, PNG, WebP, AVIF, HEIC, TIFF, BMP
- **Compression intelligente** avec préservation de la qualité
- **Redimensionnement automatique** selon vos besoins
- **Conversion de format** optionnelle
- **Optimisation des métadonnées** (suppression EXIF)

### 🎵 Audio
- **Formats supportés** : MP3, FLAC, WAV, AAC, OGG, M4A
- **Compression variable** (CBR/VBR)
- **Normalisation du volume** automatique
- **Conversion multi-format** simultanée
- **Réduction de fréquence d'échantillonnage**

### 🎬 Vidéo
- **Formats supportés** : MP4, AVI, MKV, WebM, MOV, FLV
- **Codecs modernes** : H.264, H.265/HEVC, VP9, AV1
- **Compression adaptative** selon le contenu
- **Redimensionnement et recadrage** automatique
- **Optimisation pour le streaming** web

### 📄 Documents
- **PDF** : Compression des images intégrées
- **Optimisation de la structure** du document
- **Suppression des métadonnées** sensibles

## 🏗️ Architecture

```
┌─────────────────┐    HTTP/WebSocket    ┌─────────────────┐
│                 │ ◄─────────────────► │                 │
│    Frontend     │                     │     Backend     │
│   (React/Vue)   │                     │   (Node.js)     │
│                 │                     │                 │
└─────────────────┘                     └─────────────────┘
                                                 │
                                                 ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│                 │    │                 │    │                 │
│   File Upload   │    │  Processing     │    │   FFmpeg        │
│   & Settings    │    │     Queue       │    │  ImageMagick    │
│                 │    │   (Redis)       │    │   PDF-lib       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Installation & Déploiement

### Option 1 : Docker (Recommandé)

```bash
# Cloner le repository
git clone https://github.com/votre-username/file-optimizer.git
cd file-optimizer

# Lancer avec Docker Compose
docker-compose up -d

# L'application sera disponible sur http://localhost:3000
```

### Option 2 : Installation manuelle

#### Prérequis

- **Node.js** 16+ 
- **FFmpeg** installé et dans le PATH
- **ImageMagick** (optionnel, pour images avancées)
- **Redis** (pour la queue de traitement)

#### Backend

```bash
cd backend
npm install

# Configuration
cp .env.example .env
# Éditer .env avec vos paramètres

# Lancer le serveur
npm run dev
```

#### Frontend

```bash
cd frontend
npm install
npm run build
npm start
```

## ⚙️ Configuration

### Variables d'environnement

```env
# Backend
PORT=8000
REDIS_URL=redis://localhost:6379
UPLOAD_MAX_SIZE=500MB
TEMP_DIR=/tmp/uploads
CLEANUP_INTERVAL=3600

# FFmpeg
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe

# Security
CORS_ORIGIN=http://localhost:3000
JWT_SECRET=your-secret-key
RATE_LIMIT=100

# Storage
STORAGE_TYPE=local # ou s3, gcs
S3_BUCKET=your-bucket
S3_REGION=eu-west-1
```

### Paramètres de compression par défaut

```json
{
  "images": {
    "quality": 80,
    "maxWidth": 1920,
    "maxHeight": 1080,
    "format": "auto"
  },
  "videos": {
    "codec": "h264",
    "crf": 23,
    "preset": "medium",
    "maxBitrate": "2M"
  },
  "audio": {
    "codec": "aac",
    "bitrate": "128k",
    "sampleRate": 44100
  }
}
```

## 📊 Performances & Limites

### Performances typiques

| Type de fichier | Taille max | Temps de traitement | Compression moyenne |
|-----------------|------------|--------------------|--------------------|
| **Image JPEG**  | 50 MB      | 2-5 secondes       | 30-70%            |
| **Vidéo HD**    | 2 GB       | 2-10 minutes       | 40-80%            |
| **Audio FLAC**  | 200 MB     | 10-30 secondes     | 50-90%            |
| **PDF**         | 100 MB     | 5-15 secondes      | 10-60%            |

### Limites recommandées

- **Fichier unique** : 5 GB max
- **Traitement simultané** : 10 fichiers
- **Stockage temporaire** : 50 GB
- **Rétention** : 24 heures

## 🛠️ API Documentation

### Upload de fichier

```http
POST /api/upload
Content-Type: multipart/form-data

{
  "file": [binary],
  "settings": {
    "quality": 80,
    "maxWidth": 1920,
    "format": "jpeg"
  }
}
```

### Statut du traitement

```http
GET /api/status/:jobId

Response:
{
  "status": "processing|completed|error",
  "progress": 45,
  "originalSize": 15728640,
  "compressedSize": 4718592,
  "compressionRatio": 70,
  "eta": 120
}
```

### Téléchargement

```http
GET /api/download/:jobId

Response: [binary file]
```

## 🔧 Développement

### Structure du projet

```
file-optimizer/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── utils/
│   │   └── workers/
│   ├── tests/
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── utils/
│   ├── public/
│   └── package.json
├── docker-compose.yml
└── README.md
```

### Lancer en mode développement

```bash
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Frontend  
cd frontend && npm run dev

# Terminal 3 - Redis
redis-server

# Terminal 4 - Worker
cd backend && npm run worker
```

### Tests

```bash
# Tests backend
cd backend && npm test

# Tests frontend
cd frontend && npm test

# Tests d'intégration
npm run test:e2e
```

## 🐳 Docker

### Dockerfile multi-stage

```dockerfile
# Frontend build
FROM node:18-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Backend avec FFmpeg
FROM node:18-alpine AS backend
RUN apk add --no-cache ffmpeg imagemagick
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --only=production
COPY backend/ ./
COPY --from=frontend /app/frontend/dist ./public

EXPOSE 8000
CMD ["npm", "start"]
```

### Docker Compose

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:8000"
    environment:
      - REDIS_URL=redis://redis:6379
    volumes:
      - uploads:/tmp/uploads
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  worker:
    build: .
    command: npm run worker
    environment:
      - REDIS_URL=redis://redis:6379
    volumes:
      - uploads:/tmp/uploads
    depends_on:
      - redis

volumes:
  uploads:
  redis_data:
```

## 📈 Monitoring & Logs

### Métriques disponibles

- **Débit** : Fichiers traités par heure
- **Temps de traitement** moyen par type
- **Taux de compression** moyen
- **Utilisation CPU/Mémoire**
- **Erreurs** et causes

### Intégrations

- **Prometheus** + Grafana pour métriques
- **Winston** pour logs structurés
- **Sentry** pour monitoring erreurs
- **Health checks** Docker

## 🔒 Sécurité

### Mesures implémentées

- **Rate limiting** par IP
- **Validation** stricte des fichiers uploadés
- **Scan antivirus** optionnel (ClamAV)
- **Chiffrement** des fichiers temporaires
- **Nettoyage automatique** des fichiers
- **CORS** configuré strictement

### Recommandations

- Utiliser HTTPS en production
- Configurer un reverse proxy (Nginx)
- Limiter les tailles d'upload
- Monitorer l'espace disque
- Sauvegardes régulières des configurations

## 🤝 Contribution

1. **Fork** le projet
2. **Créer** une branche feature (`git checkout -b feature/amazing-feature`)
3. **Commit** vos changements (`git commit -m 'Add amazing feature'`)
4. **Push** vers la branche (`git push origin feature/amazing-feature`)
5. **Ouvrir** une Pull Request

### Guidelines

- Code formaté avec Prettier
- Tests unitaires pour nouvelles fonctionnalités
- Documentation mise à jour
- Commits conventionnels

## 📝 Roadmap

### Version 2.1
- [ ] Support WebAssembly pour compression côté client
- [ ] Interface mobile dédiée
- [ ] Compression batch programmée
- [ ] Intégration cloud storage (S3, GCS)

### Version 2.2
- [ ] Machine Learning pour compression optimale
- [ ] API GraphQL
- [ ] Plugin WordPress/Drupal
- [ ] Support formats RAW photo

### Version 3.0
- [ ] Clustering multi-serveurs
- [ ] CDN intégré
- [ ] Compression temps réel streaming
- [ ] Interface admin avancée

## 🆘 Support

### Documentation
- [Wiki complet](https://github.com/votre-username/file-optimizer/wiki)
- [FAQ](https://github.com/votre-username/file-optimizer/wiki/FAQ)
- [Troubleshooting](https://github.com/votre-username/file-optimizer/wiki/Troubleshooting)

### Communauté
- [Discord](https://discord.gg/file-optimizer)
- [Forum](https://forum.file-optimizer.com)
- [Issues GitHub](https://github.com/votre-username/file-optimizer/issues)

### Support commercial
- Email : support@file-optimizer.com
- Consulting : consulting@file-optimizer.com

## 📄 License

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 🙏 Remerciements

- **FFmpeg** pour le moteur de traitement multimédia
- **ImageMagick** pour le traitement d'images avancé
- **Redis** pour la gestion des queues
- La communauté **open source** pour les contributions

---

**Made with ❤️ by [Votre Nom]**

> 💡 **Astuce** : Commencez par la version Docker pour un déploiement rapide, puis personnalisez selon vos besoins !