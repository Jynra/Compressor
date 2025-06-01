#!/bin/bash
# scripts/health-check.sh
# Script de vérification de santé complète du système

set -e

# Configuration
API_URL="${API_URL:-http://localhost:8000}"
VERBOSE="${1:-false}"
TIMEOUT=10
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Variables globales pour le résultat
OVERALL_STATUS=0
CHECKS_PERFORMED=0
CHECKS_PASSED=0

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
}

log_warn() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
    OVERALL_STATUS=1
}

log_check() {
    echo -e "${PURPLE}[CHECK]${NC} $1"
    CHECKS_PERFORMED=$((CHECKS_PERFORMED + 1))
}

# Vérifier l'API principale
check_api() {
    log_check "API principale"
    
    local response
    local http_code
    local response_time
    
    # Mesurer le temps de réponse
    local start_time=$(date +%s%N)
    response=$(curl -s -w "%{http_code}" --max-time $TIMEOUT "$API_URL/api/health" 2>/dev/null || echo "000")
    local end_time=$(date +%s%N)
    response_time=$(( (end_time - start_time) / 1000000 )) # en millisecondes
    
    http_code="${response: -3}"
    local body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        log_success "API opérationnelle (${response_time}ms)"
        
        # Analyser la réponse si verbose
        if [ "$VERBOSE" = "--verbose" ] || [ "$VERBOSE" = "-v" ]; then
            echo "   Response body:"
            echo "$body" | jq . 2>/dev/null || echo "   $body"
            
            # Extraire des métriques de la réponse
            local status=$(echo "$body" | jq -r '.status' 2>/dev/null || echo "unknown")
            local uptime=$(echo "$body" | jq -r '.uptime' 2>/dev/null || echo "unknown")
            echo "   Status: $status, Uptime: ${uptime}s"
        fi
        
        # Vérifier que le statut est "ok"
        if echo "$body" | grep -q '"status":"ok"'; then
            log_success "Health check interne: OK"
        else
            log_warn "Health check interne: État dégradé"
        fi
        
        return 0
    else
        log_error "API non opérationnelle (HTTP $http_code)"
        if [ "$VERBOSE" = "--verbose" ] || [ "$VERBOSE" = "-v" ]; then
            echo "   URL testée: $API_URL/api/health"
            echo "   Réponse: $response"
        fi
        return 1
    fi
}

# Vérifier Redis
check_redis() {
    log_check "Redis"
    
    # Essayer avec redis-cli local d'abord
    if command -v redis-cli &> /dev/null; then
        if timeout $TIMEOUT redis-cli -h $REDIS_HOST -p $REDIS_PORT ping 2>/dev/null | grep -q "PONG"; then
            log_success "Redis opérationnel (redis-cli)"
            
            if [ "$VERBOSE" = "--verbose" ] || [ "$VERBOSE" = "-v" ]; then
                local redis_info=$(redis-cli -h $REDIS_HOST -p $REDIS_PORT info server 2>/dev/null | head -5)
                echo "   Redis info:"
                echo "$redis_info" | sed 's/^/   /'
            fi
            return 0
        fi
    fi
    
    # Essayer avec Docker si redis-cli non disponible
    if command -v docker &> /dev/null; then
        if docker exec file-optimizer-redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
            log_success "Redis opérationnel (Docker)"
            return 0
        fi
    fi
    
    # Essayer avec netcat pour tester la connectivité
    if command -v nc &> /dev/null; then
        if timeout $TIMEOUT nc -z $REDIS_HOST $REDIS_PORT 2>/dev/null; then
            log_warn "Redis port accessible mais ping échoué"
            return 1
        fi
    fi
    
    log_error "Redis non opérationnel"
    return 1
}

# Vérifier Docker
check_docker() {
    log_check "Services Docker"
    
    if ! command -v docker &> /dev/null; then
        log_warn "Docker non installé (normal si déploiement PM2)"
        return 0
    fi
    
    # Vérifier que Docker est en cours d'exécution
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon non accessible"
        return 1
    fi
    
    # Vérifier les conteneurs file-optimizer
    local containers=$(docker ps --filter "name=file-optimizer" --format "{{.Names}}" 2>/dev/null || echo "")
    
    if [ -n "$containers" ]; then
        log_success "Conteneurs Docker actifs"
        
        if [ "$VERBOSE" = "--verbose" ] || [ "$VERBOSE" = "-v" ]; then
            echo "   Conteneurs trouvés:"
            echo "$containers" | sed 's/^/   - /'
            
            # Status détaillé des conteneurs
            docker ps --filter "name=file-optimizer" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | sed 's/^/   /'
        fi
        
        # Vérifier que les conteneurs sont "healthy" si health check configuré
        local unhealthy=$(docker ps --filter "name=file-optimizer" --filter "health=unhealthy" --format "{{.Names}}" 2>/dev/null || echo "")
        if [ -n "$unhealthy" ]; then
            log_warn "Conteneurs en mauvaise santé: $unhealthy"
            return 1
        fi
        
        return 0
    else
        log_warn "Aucun conteneur file-optimizer actif"
        return 1
    fi
}

# Vérifier l'espace disque
check_disk_space() {
    log_check "Espace disque"
    
    # Vérifier le répertoire de déploiement
    local deploy_paths=("/opt/file-optimizer" "/opt/file-optimizer-staging" ".")
    
    for path in "${deploy_paths[@]}"; do
        if [ -d "$path" ]; then
            local usage=$(df "$path" 2>/dev/null | awk 'NR==2 {print $5}' | sed 's/%//' || echo "0")
            local available=$(df -h "$path" 2>/dev/null | awk 'NR==2 {print $4}' || echo "unknown")
            
            if [ "$usage" -lt 80 ]; then
                log_success "Espace disque OK: ${usage}% utilisé ($available disponible) - $path"
            elif [ "$usage" -lt 90 ]; then
                log_warn "Espace disque élevé: ${usage}% utilisé ($available disponible) - $path"
            else
                log_error "Espace disque critique: ${usage}% utilisé ($available disponible) - $path"
                return 1
            fi
            
            if [ "$VERBOSE" = "--verbose" ] || [ "$VERBOSE" = "-v" ]; then
                echo "   Détails $path:"
                df -h "$path" | sed 's/^/   /'
            fi
            break
        fi
    done
    
    return 0
}

# Vérifier la mémoire système
check_memory() {
    log_check "Utilisation mémoire"
    
    if [ -f /proc/meminfo ]; then
        local total_mem=$(grep MemTotal /proc/meminfo | awk '{print $2}')
        local available_mem=$(grep MemAvailable /proc/meminfo | awk '{print $2}' 2>/dev/null || grep MemFree /proc/meminfo | awk '{print $2}')
        local used_mem=$((total_mem - available_mem))
        local usage_percent=$((used_mem * 100 / total_mem))
        
        # Convertir en GB pour affichage
        local total_gb=$((total_mem / 1024 / 1024))
        local used_gb=$((used_mem / 1024 / 1024))
        local available_gb=$((available_mem / 1024 / 1024))
        
        if [ "$usage_percent" -lt 80 ]; then
            log_success "Mémoire OK: ${usage_percent}% utilisé (${used_gb}G/${total_gb}G)"
        elif [ "$usage_percent" -lt 90 ]; then
            log_warn "Mémoire élevée: ${usage_percent}% utilisé (${used_gb}G/${total_gb}G)"
        else
            log_error "Mémoire critique: ${usage_percent}% utilisé (${used_gb}G/${total_gb}G)"
            return 1
        fi
        
        if [ "$VERBOSE" = "--verbose" ] || [ "$VERBOSE" = "-v" ]; then
            echo "   Total: ${total_gb}G, Utilisé: ${used_gb}G, Disponible: ${available_gb}G"
        fi
    else
        log_warn "Impossible de lire /proc/meminfo"
    fi
    
    return 0
}

# Vérifier les processus PM2
check_pm2() {
    log_check "Processus PM2"
    
    if ! command -v pm2 &> /dev/null; then
        log_warn "PM2 non installé (normal si déploiement Docker)"
        return 0
    fi
    
    local pm2_list=$(pm2 jlist 2>/dev/null | jq -r '.[] | select(.name | test("file-optimizer")) | "\(.name): \(.pm2_env.status)"' 2>/dev/null || echo "")
    
    if [ -n "$pm2_list" ]; then
        local all_online=true
        while IFS= read -r line; do
            if echo "$line" | grep -q ": online"; then
                log_success "PM2 process: $line"
            else
                log_error "PM2 process: $line"
                all_online=false
            fi
        done <<< "$pm2_list"
        
        if [ "$VERBOSE" = "--verbose" ] || [ "$VERBOSE" = "-v" ]; then
            echo "   PM2 status détaillé:"
            pm2 status | grep -E "(file-optimizer|Process)" | sed 's/^/   /'
        fi
        
        if $all_online; then
            return 0
        else
            return 1
        fi
    else
        log_warn "Aucun processus file-optimizer dans PM2"
        return 1
    fi
}

# Vérifier les endpoints critiques
check_endpoints() {
    log_check "Endpoints critiques"
    
    local endpoints=(
        "/api/health"
        "/api/upload/info"
        "/"
    )
    
    local failed_endpoints=()
    
    for endpoint in "${endpoints[@]}"; do
        local url="$API_URL$endpoint"
        local http_code=$(curl -s -w "%{http_code}" --max-time $TIMEOUT "$url" -o /dev/null 2>/dev/null || echo "000")
        
        if [ "$http_code" = "200" ]; then
            log_success "Endpoint OK: $endpoint (HTTP $http_code)"
        else
            log_error "Endpoint KO: $endpoint (HTTP $http_code)"
            failed_endpoints+=("$endpoint")
        fi
    done
    
    if [ ${#failed_endpoints[@]} -eq 0 ]; then
        return 0
    else
        if [ "$VERBOSE" = "--verbose" ] || [ "$VERBOSE" = "-v" ]; then
            echo "   Endpoints en échec: ${failed_endpoints[*]}"
        fi
        return 1
    fi
}

# Test de performance simple
check_performance() {
    log_check "Performance API"
    
    local total_time=0
    local requests=5
    local failed=0
    
    for i in $(seq 1 $requests); do
        local start_time=$(date +%s%N)
        local http_code=$(curl -s -w "%{http_code}" --max-time $TIMEOUT "$API_URL/api/health" -o /dev/null 2>/dev/null || echo "000")
        local end_time=$(date +%s%N)
        local response_time=$(( (end_time - start_time) / 1000000 ))
        
        if [ "$http_code" = "200" ]; then
            total_time=$((total_time + response_time))
        else
            failed=$((failed + 1))
        fi
    done
    
    if [ $failed -lt $((requests / 2)) ]; then
        local avg_time=$((total_time / (requests - failed)))
        if [ $avg_time -lt 1000 ]; then
            log_success "Performance OK: ${avg_time}ms moyenne ($failed échecs sur $requests)"
        elif [ $avg_time -lt 3000 ]; then
            log_warn "Performance lente: ${avg_time}ms moyenne ($failed échecs sur $requests)"
        else
            log_error "Performance critique: ${avg_time}ms moyenne ($failed échecs sur $requests)"
            return 1
        fi
        
        if [ "$VERBOSE" = "--verbose" ] || [ "$VERBOSE" = "-v" ]; then
            echo "   Tests: $requests, Échecs: $failed, Temps moyen: ${avg_time}ms"
        fi
        return 0
    else
        log_error "Performance critique: trop d'échecs ($failed sur $requests)"
        return 1
    fi
}

# Afficher le résumé final
show_summary() {
    echo ""
    echo "========================================"
    echo "📊 RÉSUMÉ DU HEALTH CHECK"
    echo "========================================"
    echo "Checks effectués: $CHECKS_PERFORMED"
    echo "Checks réussis: $CHECKS_PASSED"
    echo "Checks échoués: $((CHECKS_PERFORMED - CHECKS_PASSED))"
    echo ""
    
    if [ $OVERALL_STATUS -eq 0 ]; then
        log_success "🎉 Tous les services sont opérationnels"
        echo ""
        echo "✅ Le système File Optimizer fonctionne correctement"
        echo "📍 Application accessible sur: $API_URL"
    else
        log_error "⚠️  Certains services ont des problèmes"
        echo ""
        echo "❌ Des problèmes ont été détectés"
        echo "🔧 Vérifiez les logs et corrigez les erreurs signalées"
        echo ""
        echo "🆘 Commandes de diagnostic utiles:"
        echo "   - Logs Docker: docker-compose logs -f"
        echo "   - Logs PM2: pm2 logs"
        echo "   - Status conteneurs: docker ps"
        echo "   - Test manuel API: curl $API_URL/api/health"
    fi
    
    echo "========================================"
}

# Fonction principale
main() {
    echo "🏥 File Optimizer Health Check"
    echo "======================================="
    echo "URL testée: $API_URL"
    echo "Mode: $([ "$VERBOSE" = "--verbose" ] || [ "$VERBOSE" = "-v" ] && echo "Verbose" || echo "Standard")"
    echo "======================================="
    echo ""
    
    # Exécuter tous les checks
    check_api || true
    check_redis || true
    check_docker || true
    check_disk_space || true
    check_memory || true
    check_pm2 || true
    check_endpoints || true
    check_performance || true
    
    # Afficher le résumé
    show_summary
    
    # Retourner le code d'erreur global
    exit $OVERALL_STATUS
}

# Parse des arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE="--verbose"
            shift
            ;;
        --url)
            API_URL="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --redis-host)
            REDIS_HOST="$2"
            shift 2
            ;;
        --redis-port)
            REDIS_PORT="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --verbose, -v         Mode verbeux avec détails"
            echo "  --url URL             URL de l'API (default: http://localhost:8000)"
            echo "  --timeout SECONDS     Timeout des requêtes (default: 10)"
            echo "  --redis-host HOST     Host Redis (default: localhost)"
            echo "  --redis-port PORT     Port Redis (default: 6379)"
            echo "  --help, -h            Afficher cette aide"
            echo ""
            echo "Exemples:"
            echo "  $0                    Health check standard"
            echo "  $0 --verbose          Health check détaillé"
            echo "  $0 --url http://localhost:8001  Test staging"
            echo ""
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