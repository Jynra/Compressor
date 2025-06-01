#!/bin/bash
# scripts/deploy-production.sh
# Script de déploiement en production

set -e

echo "🚀 Déploiement File Optimizer en production"

# Configuration
REPO_URL="https://github.com/your-username/file-optimizer.git"
DEPLOY_DIR="/opt/file-optimizer"
BACKUP_DIR="/opt/backups/file-optimizer"
SERVICE_NAME="file-optimizer"
BRANCH="main"

# Couleurs pour les logs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Vérifier les prérequis
check_prerequisites() {
    log_info "Vérification des prérequis..."
    
    # Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js n'est pas installé"
        exit 1
    fi
    
    local node_version=$(node --version | cut -d'v' -f2)
    local major_version=$(echo $node_version | cut -d'.' -f1)
    if [ "$major_version" -lt 16 ]; then
        log_error "Node.js version >= 16 requise (actuelle: $node_version)"
        exit 1
    fi
    
    # Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker n'est pas installé"
        exit 1
    fi
    
    # Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose n'est pas installé"
        exit 1
    fi
    
    # Git
    if ! command -v git &> /dev/null; then
        log_error "Git n'est pas installé"
        exit 1
    fi
    
    # Vérifier l'espace disque (minimum 5GB)
    local available_space=$(df /opt 2>/dev/null | awk 'NR==2 {print $4}' || echo "0")
    if [ "$available_space" -lt 5242880 ]; then # 5GB en KB
        log_warn "Espace disque faible (moins de 5GB disponible)"
    fi
    
    log_success "Prérequis vérifiés"
}

# Créer sauvegarde
create_backup() {
    log_info "Création de la sauvegarde..."
    
    if [ -d "$DEPLOY_DIR" ]; then
        mkdir -p "$BACKUP_DIR"
        BACKUP_FILE="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).tar.gz"
        
        # Créer la sauvegarde en excluant les gros répertoires
        tar -czf "$BACKUP_FILE" -C "$DEPLOY_DIR" . \
            --exclude=node_modules \
            --exclude=uploads \
            --exclude=logs \
            --exclude=.git \
            --exclude=tmp \
            2>/dev/null || true
        
        if [ -f "$BACKUP_FILE" ]; then
            log_success "Sauvegarde créée: $BACKUP_FILE"
        else
            log_warn "Échec création sauvegarde"
        fi
    else
        log_warn "Aucun déploiement existant à sauvegarder"
    fi
}

# Arrêter les services en cours
stop_services() {
    log_info "Arrêt des services existants..."
    
    # Arrêter Docker Compose si en cours
    if [ -f "$DEPLOY_DIR/docker-compose.yml" ]; then
        cd "$DEPLOY_DIR"
        docker-compose down 2>/dev/null || true
        log_info "Services Docker arrêtés"
    fi
    
    # Arrêter PM2 si en cours
    if command -v pm2 &> /dev/null; then
        pm2 stop ecosystem.config.js 2>/dev/null || true
        log_info "Services PM2 arrêtés"
    fi
}

# Cloner ou mettre à jour le repository
update_code() {
    log_info "Mise à jour du code..."
    
    if [ -d "$DEPLOY_DIR/.git" ]; then
        cd "$DEPLOY_DIR"
        git fetch origin --quiet
        git checkout "$BRANCH" --quiet
        git reset --hard "origin/$BRANCH" --quiet
        local commit_hash=$(git rev-parse --short HEAD)
        log_success "Code mis à jour depuis Git (commit: $commit_hash)"
    else
        # Créer le répertoire parent si nécessaire
        mkdir -p "$(dirname "$DEPLOY_DIR")"
        git clone --branch "$BRANCH" "$REPO_URL" "$DEPLOY_DIR" --quiet
        cd "$DEPLOY_DIR"
        local commit_hash=$(git rev-parse --short HEAD)
        log_success "Repository cloné (commit: $commit_hash)"
    fi
}

# Installer les dépendances
install_dependencies() {
    log_info "Installation des dépendances..."
    cd "$DEPLOY_DIR/backend"
    
    # Nettoyer node_modules existants
    if [ -d "node_modules" ]; then
        rm -rf node_modules package-lock.json
        log_info "Anciens node_modules supprimés"
    fi
    
    # Installation propre
    npm ci --only=production --silent
    
    log_success "Dépendances installées"
}

# Configuration de l'environnement
setup_environment() {
    log_info "Configuration de l'environnement..."
    cd "$DEPLOY_DIR/backend"
    
    # Copier la configuration si elle n'existe pas
    if [ ! -f ".env" ]; then
        cp .env.example .env
        log_warn "Fichier .env créé depuis .env.example"
        log_warn "⚠️  Configurer manuellement les variables dans .env"
    fi
    
    # Créer les répertoires nécessaires
    mkdir -p uploads logs tmp
    chmod 755 uploads logs tmp
    
    # Créer les répertoires au niveau système si nécessaire
    sudo mkdir -p /opt/file-optimizer/uploads /opt/file-optimizer/logs 2>/dev/null || true
    sudo chown -R $USER:$USER /opt/file-optimizer 2>/dev/null || true
    
    log_success "Environnement configuré"
}

# Démarrer les services
start_services() {
    log_info "Démarrage des services..."
    cd "$DEPLOY_DIR"
    
    # Choisir la méthode de déploiement
    if [ "$DEPLOY_METHOD" = "pm2" ] && command -v pm2 &> /dev/null; then
        start_pm2_services
    else
        start_docker_services
    fi
}

# Démarrer avec Docker Compose
start_docker_services() {
    log_info "Démarrage avec Docker Compose..."
    
    # Pull des dernières images
    docker-compose pull --quiet
    
    # Démarrer les services
    docker-compose up -d
    
    # Attendre que les services soient prêts
    log_info "Attente du démarrage des services..."
    sleep 15
    
    # Vérifier que les conteneurs sont en cours d'exécution
    if docker-compose ps | grep -q "Up"; then
        log_success "Services Docker démarrés"
    else
        log_error "Échec du démarrage des services Docker"
        docker-compose logs
        exit 1
    fi
}

# Démarrer avec PM2
start_pm2_services() {
    log_info "Démarrage avec PM2..."
    cd "$DEPLOY_DIR/backend"
    
    # Démarrer avec PM2
    pm2 start ecosystem.config.js --env production
    
    # Sauvegarder la configuration PM2
    pm2 save
    
    log_success "Services PM2 démarrés"
}

# Tests post-déploiement
run_health_checks() {
    log_info "Tests de santé post-déploiement..."
    
    # Attendre un peu plus pour s'assurer que tout est prêt
    sleep 10
    
    # Déterminer le port selon la méthode de déploiement
    local port=8000
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f "http://localhost:$port/api/health" >/dev/null 2>&1; then
            log_success "API opérationnelle sur le port $port"
            break
        else
            if [ $attempt -eq $max_attempts ]; then
                log_error "API non accessible après $max_attempts tentatives"
                # Afficher les logs pour diagnostic
                if [ "$DEPLOY_METHOD" = "pm2" ]; then
                    pm2 logs --lines 20
                else
                    docker-compose logs --tail=20
                fi
                exit 1
            fi
            log_info "Tentative $attempt/$max_attempts - Attente de l'API..."
            sleep 2
            attempt=$((attempt + 1))
        fi
    done
    
    # Test de santé détaillé
    local health_response=$(curl -s "http://localhost:$port/api/health" 2>/dev/null || echo "")
    if echo "$health_response" | grep -q '"status":"ok"'; then
        log_success "Health check détaillé réussi"
    else
        log_warn "Health check détaillé partiel"
    fi
    
    # Test Redis si Docker
    if [ "$DEPLOY_METHOD" != "pm2" ]; then
        if docker exec file-optimizer-redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
            log_success "Redis opérationnel"
        else
            log_warn "Redis non accessible (peut être normal si externe)"
        fi
    fi
    
    log_success "Tous les tests de santé essentiels passés"
}

# Nettoyage post-déploiement
cleanup() {
    log_info "Nettoyage post-déploiement..."
    
    # Nettoyer les anciennes images Docker
    if [ "$DEPLOY_METHOD" != "pm2" ]; then
        docker image prune -f >/dev/null 2>&1 || true
    fi
    
    # Nettoyer les anciennes sauvegardes (garder les 5 dernières)
    if [ -d "$BACKUP_DIR" ]; then
        ls -t "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm
    fi
    
    log_success "Nettoyage terminé"
}

# Afficher les informations finales
show_deployment_info() {
    log_success "🎉 Déploiement production terminé avec succès!"
    echo ""
    echo "📍 Informations de déploiement:"
    echo "   Application: http://localhost:8000"
    echo "   Health check: http://localhost:8000/api/health"
    echo "   API Documentation: http://localhost:8000/docs"
    echo ""
    echo "📋 Commandes utiles:"
    if [ "$DEPLOY_METHOD" = "pm2" ]; then
        echo "   Logs: pm2 logs"
        echo "   Status: pm2 status"
        echo "   Restart: pm2 restart ecosystem.config.js"
    else
        echo "   Logs: docker-compose logs -f"
        echo "   Status: docker-compose ps"
        echo "   Restart: docker-compose restart"
    fi
    echo "   Health: curl http://localhost:8000/api/health"
    echo ""
}

# Fonction de rollback en cas d'erreur
rollback() {
    log_error "Erreur détectée, tentative de rollback..."
    
    # Trouver la dernière sauvegarde
    if [ -d "$BACKUP_DIR" ]; then
        local latest_backup=$(ls -t "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null | head -n1)
        if [ -n "$latest_backup" ]; then
            log_info "Restauration depuis: $latest_backup"
            cd "$DEPLOY_DIR"
            tar -xzf "$latest_backup" 2>/dev/null || true
            start_services
            log_warn "Rollback effectué, vérifiez l'état du service"
        fi
    fi
}

# Fonction principale
main() {
    log_info "Début du déploiement production"
    echo "========================================"
    
    # Déterminer la méthode de déploiement
    DEPLOY_METHOD=${DEPLOY_METHOD:-docker}
    log_info "Méthode de déploiement: $DEPLOY_METHOD"
    
    check_prerequisites
    create_backup
    stop_services
    update_code
    install_dependencies
    setup_environment
    start_services
    run_health_checks
    cleanup
    show_deployment_info
}

# Gestion des erreurs avec rollback
trap 'rollback; exit 1' ERR

# Parse des arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --method)
            DEPLOY_METHOD="$2"
            shift 2
            ;;
        --branch)
            BRANCH="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [--method docker|pm2] [--branch main|develop]"
            echo "  --method: Méthode de déploiement (default: docker)"
            echo "  --branch: Branche Git à déployer (default: main)"
            exit 0
            ;;
        *)
            log_warn "Option inconnue: $1"
            shift
            ;;
    esac
done

# Exécution
main "$@"