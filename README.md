# 🗜️ Compressor - Optimiseur de Fichiers Multimédia

Une solution self-hosted complète pour compresser et optimiser tous vos fichiers multimédia tout en conservant leur format original.

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue.svg)

## 🎯 Objectif

Réduire la taille de vos fichiers multimédia sans changer leur format, avec une interface web moderne et un backend performant utilisant FFmpeg et Sharp.

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
│   (HTML/CSS/JS) │                     │   (Node.js)     │
│                 │                     │                 │
└─────────────────┘                     └─────────────────┘
                                                 │
                                                 ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│                 │    │                 │    │                 │
│   File Upload   │    │  Processing     │    │   FFmpeg        │
│   & Settings    │    │     Queue       │    │   Sharp         │
│                 │    │   (Redis)       │    │   PDF-lib       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Installation Rapide avec Docker

### Prérequis
- Docker et Docker Compose installés
- 2GB RAM minimum
- 10GB espace disque libre

### Déploiement en 3 étapes

```bash
# 1. Cloner le repository
git clone https://github.com/your-username/compressor.git
cd compressor

# 2. Configurer l'environnement
cp .env.example .env
nano .env  # Modifier JWT_SECRET et CORS_ORIGIN

# 3. Créer les dossiers requis et lancer Compressor
mkdir logs uploads
docker-compose up -d
```

**C'est tout ! 🎉**

### Accès à l'application
- **Interface Web** : http://localhost:3001
- **API** : http://localhost:8081
- **Health Check** : http://localhost:8081/api/health

## 🔧 Configuration

### Variables d'environnement essentielles

```env
# Sécurité (OBLIGATOIRE à changer)
JWT_SECRET=your-super-secret-key-change-this-NOW

# CORS (URLs autorisées)
CORS_ORIGIN=http://localhost:3001,https://your-domain.com

# Stockage
UPLOADS_PATH=./uploads
LOGS_PATH=./logs

# Performance
WORKER_CONCURRENCY=2
UPLOAD_MAX_SIZE=5368709120  # 5GB
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
    "preset": "medium"
  },
  "audio": {
    "codec": "aac",
    "bitrate": "128k",
    "sampleRate": 44100
  }
}
```

## 📊 Performances

### Performances typiques

| Type de fichier | Taille max | Temps de traitement | Compression moyenne |
|-----------------|------------|--------------------|--------------------|
| **Image JPEG**  | 50 MB      | 2-5 secondes       | 30-70%            |
| **Vidéo HD**    | 2 GB       | 2-10 minutes       | 40-80%            |
| **Audio FLAC**  | 200 MB     | 10-30 secondes     | 50-90%            |
| **PDF**         | 100 MB     | 5-15 secondes      | 10-60%            |

### Stack Compressor

| Service | Port | Rôle |
|---------|------|------|
| **compressor-frontend** | 3001 | Interface utilisateur |
| **compressor-app** | 8081 | API REST + WebSocket |
| **compressor-worker** | - | Traitement fichiers |
| **compressor-redis** | - | Queue + Cache |

## 🛠️ Utilisation

### Interface Web
1. **Glissez-déposez** vos fichiers dans la zone d'upload
2. **Ajustez** les paramètres de compression (optionnel)
3. **Suivez** la progression en temps réel
4. **Téléchargez** vos fichiers optimisés

### API REST

#### Upload d'un fichier
```bash
curl -X POST http://localhost:8081/api/upload \
  -F "file=@image.jpg" \
  -F 'settings={"quality":85,"maxWidth":1920}'
```

#### Récupérer le statut
```bash
curl http://localhost:8081/api/status/job-id
```

#### Télécharger le résultat
```bash
curl http://localhost:8081/api/download/job-id -o optimized-image.jpg
```

### WebSocket (Temps réel)
```javascript
const socket = io('http://localhost:8081');

socket.on('job-progress', (data) => {
    console.log(`Job ${data.jobId}: ${data.progress}%`);
});

socket.on('job-completed', (data) => {
    console.log(`Job terminé: ${data.compressionRatio}% de compression`);
});
```

## 🔍 Monitoring et Logs

### Commandes utiles

```bash
# Voir l'état de la stack
docker-compose ps

# Logs en temps réel
docker-compose logs -f

# Stats de performance
docker stats compressor-app compressor-worker

# Health check
curl http://localhost:8081/api/health
```

### Métriques disponibles
- **Débit** : Fichiers traités par heure
- **Temps de traitement** moyen par type
- **Taux de compression** moyen
- **Utilisation CPU/Mémoire**
- **Files d'attente** Redis

## 🔒 Sécurité

### Mesures implémentées
- **Rate limiting** par IP
- **Validation** stricte des fichiers uploadés
- **Scan de signatures** (magic bytes)
- **Isolation Docker** complète
- **JWT** pour authentification
- **CORS** configuré strictement

### Recommandations production
- Utiliser HTTPS avec reverse proxy
- Configurer un pare-feu
- Limiter l'accès réseau
- Surveiller l'espace disque
- Sauvegardes régulières

## 🛠️ Maintenance

### Backup
```bash
# Sauvegarder les données
docker run --rm \
  -v compressor_uploads:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/compressor-backup-$(date +%Y%m%d).tar.gz -C /data .
```

### Mise à jour
```bash
# Arrêter, mettre à jour et redémarrer
docker-compose down
git pull origin main
docker-compose build --no-cache
docker-compose up -d
```

### Nettoyage
```bash
# Nettoyer les fichiers temporaires
docker-compose exec compressor-app npm run cleanup

# Nettoyer Docker
docker system prune -a
```

## 🐛 Dépannage

### Problèmes courants

#### L'application ne démarre pas
```bash
# Vérifier les logs
docker-compose logs compressor-app

# Vérifier la configuration
docker-compose config

# Rebuilder complètement
docker-compose build --no-cache
```

#### Erreur de connexion Redis
```bash
# Vérifier Redis
docker-compose logs compressor-redis

# Redémarrer Redis
docker-compose restart compressor-redis
```

#### Upload échoue
```bash
# Vérifier l'espace disque
df -h

# Vérifier les permissions
ls -la uploads/

# Vérifier les logs d'upload
docker-compose logs compressor-app | grep upload
```

#### Port déjà utilisé
```bash
# Trouver quel processus utilise le port
sudo lsof -i :8081

# Modifier le port dans docker-compose.yml si nécessaire
# Changer "8081:8000" vers "8082:8000" par exemple
```

### Fichiers manquants

Si vous rencontrez des erreurs de montage de volumes :

```bash
# Créer les dossiers requis
mkdir -p logs uploads nginx

# Vérifier la structure
ls -la
# Doit afficher : logs/ uploads/ nginx/ backend/ frontend/
```

## 🚀 Déploiement Production

### Configuration serveur

```bash
# Configurer les variables de production
cp .env.example .env
nano .env

# Variables critiques à modifier :
JWT_SECRET=your-super-secure-generated-key-here
CORS_ORIGIN=https://compressor.yourdomain.com
UPLOADS_PATH=/data/compressor/uploads
LOGS_PATH=/var/log/compressor
WORKER_CONCURRENCY=4
```

### Avec reverse proxy (recommandé)

```nginx
# Configuration Nginx reverse proxy
server {
    listen 80;
    server_name compressor.yourdomain.com;
    
    # Frontend
    location / {
        proxy_pass http://localhost:3001;
    }
    
    # API
    location /api/ {
        proxy_pass http://localhost:8081;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

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
- [Wiki complet](https://github.com/your-username/compressor/wiki)
- [FAQ](https://github.com/your-username/compressor/wiki/FAQ)
- [Troubleshooting](https://github.com/your-username/compressor/wiki/Troubleshooting)

### Communauté
- [Discord](https://discord.gg/compressor)
- [Issues GitHub](https://github.com/your-username/compressor/issues)

### Support commercial
- Email : support@compressor.com

## 📄 License

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 🙏 Remerciements

- **FFmpeg** pour le moteur de traitement multimédia
- **Sharp** pour le traitement d'images avancé
- **Redis** pour la gestion des queues
- La communauté **open source** pour les contributions

---

**Made with ❤️ by Compressor Team**

> 💡 **Astuce** : Commencez par `docker-compose up -d` pour un déploiement rapide, puis personnalisez selon vos besoins !

## 🚀 Démarrage rapide

```bash
git clone https://github.com/your-username/compressor.git
cd compressor
cp .env.example .env
nano .env  # Changer JWT_SECRET
mkdir logs uploads
docker-compose up -d
```

**Votre Compressor est prêt sur http://localhost:3001 ! 🎉**

---

## 📋 Points d'Accès Rapides

| Service | URL | Description |
|---------|-----|-------------|
| 🎨 **Interface** | http://localhost:3001 | Application web principale |
| 🔧 **API** | http://localhost:8081 | Backend REST |
| 🏥 **Santé** | http://localhost:8081/api/health | Monitoring système |
| 📤 **Upload** | http://localhost:8081/api/upload | Endpoint d'upload |
| 📊 **Métriques** | http://localhost:8081/api/health/metrics | Métriques détaillées |

### 🔧 Commandes de Maintenance Rapides

```bash
# Status complet
docker-compose ps && curl -s http://localhost:8081/api/health | jq

# Redémarrage rapide
docker-compose restart

# Logs en temps réel
docker-compose logs -f --tail=50

# Nettoyage complet
docker-compose down && docker system prune -f && docker-compose up -d
```