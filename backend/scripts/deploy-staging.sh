#!/bin/bash
# scripts/deploy-staging.sh
# Script de déploiement en staging pour tests

set -e

echo "🔧 Déploiement File Optimizer en staging"

# Configuration staging
REPO_URL="https://github.com/your-username/file-optimizer.git"
DEPLOY_DIR="/opt/file-optimizer-staging"
BRANCH="develop"
PORT="8001"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[STAGING]${NC} $1"
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

# Vérification des prérequis simplifiée
check_prerequisites() {
    log_info "Vérification des prérequis staging..."
    
    if ! command -v node &> /dev/null; then
        log_error "Node.js non installé"
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        log_error "Docker non installé"
        exit 1
    fi
    
    if ! command -v git &> /dev/null; then
        log_error "Git non installé"
        exit 1
    fi
    
    log_success "Prérequis OK"
}

# Nettoyer l'environnement staging précédent
cleanup_previous() {
    log_info "Nettoyage environnement staging précédent..."
    
    if [ -d "$DEPLOY_DIR" ]; then
        cd "$DEPLOY_DIR"
        
        # Arrêter les conteneurs staging
        docker-compose -f docker-compose.dev.yml down 2>/dev/null || true
        
        # Nettoyer les volumes staging (optionnel)
        docker volume rm file-optimizer-staging_uploads_dev 2>/dev/null || true
        docker volume rm file-optimizer-staging_redis_data_dev 2>/dev/null || true
        
        log_info "Environnement précédent nettoyé"
    fi
}

# Mettre à jour le code
update_code() {
    log_info "Mise à jour du code depuis la branche $BRANCH..."
    
    if [ -d "$DEPLOY_DIR/.git" ]; then
        cd "$DEPLOY_DIR"
        git fetch origin --quiet
        git checkout "$BRANCH" --quiet
        git reset --hard "origin/$BRANCH" --quiet
        local commit_hash=$(git rev-parse --short HEAD)
        log_success "Code mis à jour (commit: $commit_hash)"
    else
        mkdir -p "$(dirname "$DEPLOY_DIR")"
        git clone -b "$BRANCH" "$REPO_URL" "$DEPLOY_DIR" --quiet
        cd "$DEPLOY_DIR"
        local commit_hash=$(git rev-parse --short HEAD)
        log_success "Repository cloné (commit: $commit_hash)"
    fi
}

# Configuration de l'environnement staging
setup_staging_environment() {
    log_info "Configuration environnement staging..."
    cd "$DEPLOY_DIR/backend"
    
    # Créer un .env spécifique au staging
    cat > .env << EOF
# Configuration Staging
NODE_ENV=staging
PORT=$PORT
LOG_LEVEL=debug

# Redis
REDIS_URL=redis://redis:6379

# Stockage
TEMP_DIR=/app/uploads
UPLOAD_MAX_SIZE=1073741824

# CORS permissif pour staging
CORS_ORIGIN=*

# Rate limiting désactivé en staging
SKIP_RATE_LIMIT=true

# Nettoyage plus fréquent
CLEANUP_INTERVAL=1800
FILE_RETENTION=3600

# Worker
WORKER_CONCURRENCY=1
JOB_TIMEOUT=900
EOF
    
    # Créer les répertoires
    mkdir -p uploads logs tmp
    chmod 755 uploads logs tmp
    
    log_success "Environnement staging configuré"
}

# Démarrer les services staging
start_staging_services() {
    log_info "Démarrage des services staging..."
    cd "$DEPLOY_DIR"
    
    # Modifier le docker-compose.dev.yml pour staging
    export COMPOSE_PROJECT_NAME=file-optimizer-staging
    export PORT=$PORT
    
    # Démarrer avec Docker Compose développement
    docker-compose -f docker-compose.dev.yml up -d
    
    log_info "Attente du démarrage des services..."
    sleep 20
}

# Tests de santé staging
run_staging_tests() {
    log_info "Tests de santé staging..."
    
    local max_attempts=20
    local attempt=1
    
    # Test de l'API
    while [ $attempt -le $max_attempts ]; do
        if curl -f "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
            log_success "API staging opérationnelle sur le port $PORT"
            break
        else
            if [ $attempt -eq $max_attempts ]; then
                log_error "API staging non accessible après $max_attempts tentatives"
                
                # Afficher les logs pour diagnostic
                log_info "Logs des conteneurs staging:"
                docker-compose -f docker-compose.dev.yml logs --tail=20
                exit 1
            fi
            log_info "Tentative $attempt/$max_attempts..."
            sleep 3
            attempt=$((attempt + 1))
        fi
    done
    
    # Test de santé détaillé
    local health_response=$(curl -s "http://localhost:$PORT/api/health" 2>/dev/null)
    if echo "$health_response" | grep -q '"status":"ok"'; then
        log_success "Health check détaillé réussi"
        
        # Afficher quelques infos de la réponse
        echo "$health_response" | jq -r '.checks | to_entries[] | "\(.key): \(.value.status)"' 2>/dev/null || true
    else
        log_warn "Health check partiel"
    fi
    
    # Test d'upload simple
    test_upload_functionality
}

# Test d'upload simple pour validation
test_upload_functionality() {
    log_info "Test de fonctionnalité upload..."
    
    # Créer un fichier de test temporaire
    local test_file="/tmp/test-staging-$(date +%s).txt"
    echo "Test file for staging deployment" > "$test_file"
    
    # Tester l'upload
    local upload_response=$(curl -s -X POST \
        -F "file=@$test_file" \
        -F 'settings={"quality":80}' \
        "http://localhost:$PORT/api/upload" 2>/dev/null || echo "")
    
    if echo "$upload_response" | grep -q '"success":true'; then
        local job_id=$(echo "$upload_response" | jq -r '.jobId' 2>/dev/null || echo "")
        log_success "Upload test réussi (jobId: ${job_id:0:8}...)"
        
        # Test de récupération du statut
        if [ -n "$job_id" ]; then
            sleep 2
            local status_response=$(curl -s "http://localhost:$PORT/api/status/$job_id" 2>/dev/null || echo "")
            if echo "$status_response" | grep -q '"success":true'; then
                log_success "API status opérationnelle"
            fi
        fi
    else
        log_warn "Test upload échoué (peut être normal selon la configuration)"
    fi
    
    # Nettoyer
    rm -f "$test_file"
}

# Afficher les informations de staging
show_staging_info() {
    log_success "🎉 Déploiement staging terminé!"
    echo ""
    echo "📍 Informations staging:"
    echo "   Application: http://localhost:$PORT"
    echo "   Health check: http://localhost:$PORT/api/health"
    echo "   API Upload: http://localhost:$PORT/api/upload"
    echo "   Branche: $BRANCH"
    echo ""
    echo "📋 Commandes utiles staging:"
    echo "   Logs: docker-compose -f docker-compose.dev.yml logs -f"
    echo "   Status: docker-compose -f docker-compose.dev.yml ps"
    echo "   Stop: docker-compose -f docker-compose.dev.yml down"
    echo "   Restart: docker-compose -f docker-compose.dev.yml restart"
    echo ""
    echo "🧪 Tests rapides:"
    echo "   curl http://localhost:$PORT/api/health"
    echo "   curl http://localhost:$PORT/api/upload/info"
    echo ""
}

# Fonction principale
main() {
    log_info "Début du déploiement staging"
    echo "========================================"
    
    check_prerequisites
    cleanup_previous
    update_code
    setup_staging_environment
    start_staging_services
    run_staging_tests
    show_staging_info
    
    log_success "✨ Staging prêt pour les tests!"
}

# Gestion des erreurs
trap 'log_error "Erreur lors du déploiement staging ligne $LINENO"; exit 1' ERR

# Parse des arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --branch)
            BRANCH="$2"
            shift 2
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --clean)
            log_info "Nettoyage complet demandé"
            docker-compose -f docker-compose.dev.yml down -v 2>/dev/null || true
            docker system prune -f >/dev/null 2>&1 || true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --branch BRANCH    Branche à déployer (default: develop)"
            echo "  --port PORT        Port d'écoute (default: 8001)" 
            echo "  --clean            Nettoyage complet avant déploiement"
            echo "  --help             Afficher cette aide"
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