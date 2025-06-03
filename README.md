# 🗜️ Compressor - Optimiseur de Fichiers Multimédia

Une solution self-hosted complète et **sécurisée** pour compresser et optimiser tous vos fichiers multimédia tout en conservant leur format original.

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue.svg)
![Security](https://img.shields.io/badge/security-enterprise--grade-green.svg)

## 🎯 Objectif

Réduire la taille de vos fichiers multimédia sans changer leur format, avec une interface web moderne et un backend performant utilisant FFmpeg et Sharp, le tout avec une **sécurité enterprise-grade**.

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

## 🔒 Sécurité Enterprise-Grade

### 🛡️ Protection Multi-Couche
- **Path Traversal Protection** - Validation stricte des chemins de fichier
- **Magic Bytes Validation** - Vérification des signatures de fichier
- **Upload Security** - Validation en 3 étapes (pré/pendant/post)
- **Rate Limiting Intelligent** - Protection contre les attaques DDoS
- **Content Security** - Détection de contenu malveillant
- **Input Sanitization** - Nettoyage de tous les inputs utilisateur

### 🔐 Authentification & Autorisation
- **JWT Authentication** - Tokens sécurisés avec auto-expiration
- **API Key Protection** - Authentification par clé API
- **CORS Configuration** - Contrôle strict des origines
- **Headers Security** - Headers de sécurité HTTP renforcés

### 🚨 Monitoring & Audit
- **Security Logging** - Enregistrement des tentatives suspectes
- **Real-time Monitoring** - Surveillance des métriques de sécurité
- **Error Tracking** - Traçabilité complète des erreurs
- **Performance Metrics** - Monitoring des performances

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
│   & Validation  │    │     Queue       │    │   Sharp         │
│   (Sécurisé)    │    │   (Redis)       │    │   PDF-lib       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Installation Rapide avec Docker

### Prérequis
- Docker et Docker Compose installés
- 2GB RAM minimum
- 10GB espace disque libre

### Déploiement Sécurisé en 4 étapes

```bash
# 1. Cloner le repository
git clone https://github.com/your-username/compressor.git
cd compressor

# 2. Configurer l'environnement sécurisé
cp .env.example .env

# 3. ✅ IMPORTANT: Générer des clés sécurisées
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "API_KEY=$(openssl rand -hex 32)" >> .env

# 4. Personnaliser la configuration
nano .env  # Modifier CORS_ORIGIN selon vos domaines

# 5. Créer les dossiers et lancer
mkdir -p logs uploads
docker-compose up -d
```

**C'est tout ! 🎉**

### ✅ Accès à l'application (PORTS CORRIGÉS)
- **Interface Web** : http://localhost:3001
- **API Backend** : http://localhost:8081  ⬅️ **PORT CORRIGÉ**
- **Health Check** : http://localhost:8081/api/health
- **API Documentation** : http://localhost:8081/docs

## 🔧 Configuration Sécurisée

### Variables d'environnement essentielles

```env
# ✅ Sécurité (OBLIGATOIRE à changer)
JWT_SECRET=$(openssl rand -base64 32)     # Auto-généré sécurisé
API_KEY=$(openssl rand -hex 32)           # Clé API sécurisée
AUTH_ENABLED=true                         # Activer en production

# ✅ CORS (URLs autorisées - IMPORTANT)
CORS_ORIGIN=https://compressor.yourdomain.com

# ✅ Stockage sécurisé
UPLOADS_PATH=/data/compressor/uploads     # Chemin absolu recommandé
LOGS_PATH=/var/log/compressor            # Séparation des logs

# ✅ Sécurité avancée
STRICT_MIME_VALIDATION=true              # Validation MIME stricte
MAGIC_BYTES_VALIDATION=true              # Vérification signatures
DDOS_PROTECTION=true                     # Protection DDoS
MAX_REQUESTS_PER_SECOND=10               # Limite requêtes/sec
```

### Paramètres de compression par défaut

```json
{
  "images": {
    "quality": 80,
    "maxWidth": 1920,
    "maxHeight": 1080,
    "format": "auto",
    "removeMetadata": true
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

| Type de fichier | Taille max | Temps de traitement | Compression moyenne | Sécurité |
|-----------------|------------|--------------------|--------------------|----------|
| **Image JPEG**  | 50 MB      | 2-5 secondes       | 30-70%            | ✅ Validée |
| **Vidéo HD**    | 2 GB       | 2-10 minutes       | 40-80%            | ✅ Validée |
| **Audio FLAC**  | 200 MB     | 10-30 secondes     | 50-90%            | ✅ Validée |
| **PDF**         | 100 MB     | 5-15 secondes      | 10-60%            | ✅ Validée |

### Stack Compressor (PORTS CORRIGÉS)

| Service | Port | Rôle | Sécurité |
|---------|------|------|----------|
| **compressor-frontend** | 3001 | Interface utilisateur | ✅ Headers sécurisés |
| **compressor-app** | 8081 | API REST + WebSocket | ✅ Auth + Validation |
| **compressor-worker** | - | Traitement fichiers | ✅ Isolation sandbox |
| **compressor-redis** | - | Queue + Cache | ✅ Réseau interne |

## 🛠️ Utilisation

### Interface Web Sécurisée
1. **Authentifiez-vous** avec votre clé API (si activée)
2. **Glissez-déposez** vos fichiers dans la zone d'upload sécurisée
3. **Validation automatique** - Vérification des signatures et types
4. **Ajustez** les paramètres de compression (optionnel)
5. **Suivez** la progression en temps réel via WebSocket
6. **Téléchargez** vos fichiers optimisés de manière sécurisée

### API REST Sécurisée

#### Upload sécurisé d'un fichier
```bash
# Avec authentification
curl -X POST http://localhost:8081/api/upload \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "file=@image.jpg" \
  -F 'settings={"quality":85,"maxWidth":1920}'

# Sans authentification (si AUTH_ENABLED=false)
curl -X POST http://localhost:8081/api/upload \
  -F "file=@image.jpg" \
  -F 'settings={"quality":85,"maxWidth":1920}'
```

#### Récupérer le statut
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
     http://localhost:8081/api/status/job-id
```

#### Télécharger le résultat sécurisé
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
     http://localhost:8081/api/download/job-id -o optimized-image.jpg
```

### WebSocket Temps Réel Sécurisé
```javascript
const socket = io('http://localhost:8081', {
    auth: {
        token: 'YOUR_API_KEY'  // Si authentification activée
    }
});

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

# Logs de sécurité spécifiques
docker-compose logs -f | grep SECURITY

# Stats de performance
docker stats compressor-app compressor-worker

# Health check avec authentification
curl -H "Authorization: Bearer YOUR_API_KEY" \
     http://localhost:8081/api/health

# Health check détaillé
curl http://localhost:8081/api/health/detailed?includeMetrics=true
```

### Métriques de sécurité disponibles
- **Tentatives d'authentification** échouées
- **Rate limiting** déclenché
- **Fichiers suspects** rejetés
- **Path traversal** tenté
- **Magic bytes** invalides
- **Upload malveillants** bloqués

## 🔒 Sécurité Avancée

### Mesures implémentées
- **Triple validation** des uploads (pré/pendant/post-multer)
- **Magic bytes verification** stricte
- **Path traversal protection** complète
- **Rate limiting intelligent** par IP et taille
- **Content-Type validation** avec boundary
- **User-Agent filtering** anti-bot
- **JWT authentication** avec expiration
- **CORS strict** configuré par domaine
- **Headers security** (CSP, HSTS, etc.)
- **Input sanitization** sur tous les champs
- **Error handling** sans leak d'informations
- **Audit logging** complet

### Configuration de production recommandée

```env
# Sécurité maximale
AUTH_ENABLED=true
STRICT_MIME_VALIDATION=true
MAGIC_BYTES_VALIDATION=true
DDOS_PROTECTION=true
RATE_LIMIT=100
UPLOAD_RATE_LIMIT=10
MAX_REQUESTS_PER_SECOND=5

# HTTPS obligatoire
HTTPS_ENABLED=true
FORCE_HTTPS=true
CORS_ORIGIN=https://yourdomain.com

# Monitoring renforcé
LOG_LEVEL=warn
METRICS_ENABLED=true
SENTRY_DSN=your_sentry_dsn
```

### Checklist de sécurité

- [ ] ✅ JWT_SECRET généré avec `openssl rand -base64 32`
- [ ] ✅ API_KEY généré avec `openssl rand -hex 32`
- [ ] ✅ AUTH_ENABLED=true en production
- [ ] ✅ CORS_ORIGIN configuré avec vos domaines réels
- [ ] ✅ HTTPS_ENABLED=true avec certificats valides
- [ ] ✅ Firewall configuré (ports 22, 80, 443 uniquement)
- [ ] ✅ Logs de sécurité monitored
- [ ] ✅ Sauvegardes automatiques configurées
- [ ] ✅ Rate limiting ajusté selon votre trafic
- [ ] ✅ Worker isolation vérifiée

## 🛠️ Maintenance

### Backup sécurisé
```bash
# Sauvegarder les données avec chiffrement
docker run --rm \
  -v compressor_uploads:/data \
  -v $(pwd):/backup \
  alpine sh -c "tar czf - /data | openssl enc -aes-256-cbc -out /backup/compressor-backup-$(date +%Y%m%d).tar.gz.enc -k YOUR_BACKUP_PASSWORD"
```

### Mise à jour sécurisée
```bash
# Sauvegarde avant mise à jour
./backup.sh

# Arrêter, mettre à jour et redémarrer
docker-compose down
git pull origin main
docker-compose build --no-cache
docker-compose up -d

# Vérifier la sécurité
curl http://localhost:8081/api/health/detailed
```

### Audit de sécurité
```bash
# Analyser les logs de sécurité des 24 dernières heures
docker-compose logs --since 24h | grep -E "(SECURITY|ERROR|WARN)" > security-audit.log

# Vérifier les tentatives d'intrusion
grep "path traversal\|magic bytes\|suspicious" security-audit.log

# Statistiques des rejets
grep -c "rejected\|blocked\|denied" security-audit.log
```

## 🐛 Dépannage

### Problèmes de sécurité courants

#### Authentification échoue
```bash
# Vérifier la configuration JWT
echo $JWT_SECRET | base64 -d | wc -c  # Doit être >= 32

# Tester l'authentification
curl -H "Authorization: Bearer $API_KEY" http://localhost:8081/api/health
```

#### CORS bloqué
```bash
# Vérifier la configuration CORS
echo $CORS_ORIGIN

# Tester depuis le navigateur
curl -H "Origin: https://yourdomain.com" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS http://localhost:8081/api/upload
```

#### Upload rejeté pour sécurité
```bash
# Voir les logs de rejet
docker-compose logs compressor-app | grep "SECURITY.*rejected"

# Vérifier la signature du fichier
file your-file.jpg
hexdump -C your-file.jpg | head -n 3
```

#### Rate limiting activé
```bash
# Voir les stats de rate limiting
curl http://localhost:8081/api/health/metrics | jq '.rateLimit'

# Ajuster les limites si nécessaire
# Modifier RATE_LIMIT et UPLOAD_RATE_LIMIT dans .env
```

## 🚀 Déploiement Production Sécurisé

### Configuration serveur de production

```bash
# 1. Générer des clés sécurisées
JWT_SECRET=$(openssl rand -base64 32)
API_KEY=$(openssl rand -hex 32)

# 2. Configuration production sécurisée
cat > .env