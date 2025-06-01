// js/utils.js
// Utilitaires généraux pour File Optimizer

/**
 * Classe d'utilitaires généraux
 */
class Utils {
    /**
     * Formater la taille d'un fichier
     */
    static formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Déterminer le type d'un fichier basé sur son extension
     */
    static getFileType(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        
        const typeMap = {
            // Images
            jpg: 'image', jpeg: 'image', png: 'image', webp: 'image',
            avif: 'image', heic: 'image', tiff: 'image', bmp: 'image',
            
            // Vidéos
            mp4: 'video', avi: 'video', mkv: 'video', webm: 'video',
            mov: 'video', flv: 'video', m4v: 'video',
            
            // Audio
            mp3: 'audio', flac: 'audio', wav: 'audio', aac: 'audio',
            ogg: 'audio', m4a: 'audio', wma: 'audio',
            
            // Documents
            pdf: 'document'
        };

        return typeMap[ext] || 'unknown';
    }

    /**
     * Obtenir l'icône pour un type de fichier
     */
    static getFileIcon(type) {
        const icons = {
            image: '🖼️',
            video: '🎬',
            audio: '🎵',
            document: '📄',
            unknown: '📎'
        };
        
        return icons[type] || icons.unknown;
    }

    /**
     * Formater une durée en millisecondes
     */
    static formatDuration(ms) {
        if (ms < 1000) return '< 1s';
        
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}j ${hours % 24}h ${minutes % 60}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Formater une date relative (il y a X temps)
     */
    static formatRelativeTime(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        
        const diffSeconds = Math.floor(diffMs / 1000);
        const diffMinutes = Math.floor(diffSeconds / 60);
        const diffHours = Math.floor(diffMinutes / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSeconds < 60) {
            return 'À l\'instant';
        } else if (diffMinutes < 60) {
            return `Il y a ${diffMinutes}min`;
        } else if (diffHours < 24) {
            return `Il y a ${diffHours}h`;
        } else if (diffDays < 7) {
            return `Il y a ${diffDays}j`;
        } else {
            return date.toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        }
    }

    /**
     * Debounce une fonction
     */
    static debounce(func, wait, immediate = false) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                timeout = null;
                if (!immediate) func(...args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func(...args);
        };
    }

    /**
     * Throttle une fonction
     */
    static throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    /**
     * Générer un ID unique
     */
    static generateId() {
        return 'id-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
    }

    /**
     * Nettoyer une chaîne pour l'HTML
     */
    static escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Copier du texte dans le presse-papier
     */
    static async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            // Fallback pour les navigateurs plus anciens
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            return successful;
        }
    }

    /**
     * Valider une URL
     */
    static isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Obtenir les informations sur le navigateur
     */
    static getBrowserInfo() {
        const ua = navigator.userAgent;
        let browser = 'Unknown';
        
        if (ua.includes('Chrome')) browser = 'Chrome';
        else if (ua.includes('Firefox')) browser = 'Firefox';
        else if (ua.includes('Safari')) browser = 'Safari';
        else if (ua.includes('Edge')) browser = 'Edge';
        
        return {
            browser,
            userAgent: ua,
            language: navigator.language,
            platform: navigator.platform,
            cookieEnabled: navigator.cookieEnabled,
            onLine: navigator.onLine
        };
    }

    /**
     * Détecter le support de certaines fonctionnalités
     */
    static getFeatureSupport() {
        return {
            websocket: 'WebSocket' in window,
            webworker: 'Worker' in window,
            clipboard: 'clipboard' in navigator,
            notification: 'Notification' in window,
            geolocation: 'geolocation' in navigator,
            localStorage: 'localStorage' in window,
            sessionStorage: 'sessionStorage' in window,
            dragDrop: 'draggable' in document.createElement('div'),
            fileApi: 'FileReader' in window,
            canvas: 'getContext' in document.createElement('canvas')
        };
    }

    /**
     * Calculer le pourcentage de compression
     */
    static calculateCompressionRatio(originalSize, compressedSize) {
        if (originalSize === 0) return 0;
        return Math.round(((originalSize - compressedSize) / originalSize) * 100);
    }

    /**
     * Formater un ratio de compression
     */
    static formatCompressionRatio(ratio) {
        if (ratio <= 0) return 'Aucune compression';
        if (ratio < 10) return `${ratio}% (faible)`;
        if (ratio < 30) return `${ratio}% (modérée)`;
        if (ratio < 50) return `${ratio}% (bonne)`;
        if (ratio < 70) return `${ratio}% (très bonne)`;
        return `${ratio}% (excellente)`;
    }

    /**
     * Obtenir la couleur pour un statut
     */
    static getStatusColor(status) {
        const colors = {
            uploaded: '#7c3aed',
            queued: '#d97706',
            processing: '#2563eb',
            completed: '#10b981',
            error: '#ef4444',
            cancelled: '#6b7280'
        };
        
        return colors[status] || colors.uploaded;
    }

    /**
     * Créer un élément DOM avec des attributs
     */
    static createElement(tag, attributes = {}, children = []) {
        const element = document.createElement(tag);
        
        // Ajouter les attributs
        Object.entries(attributes).forEach(([key, value]) => {
            if (key === 'className') {
                element.className = value;
            } else if (key === 'innerHTML') {
                element.innerHTML = value;
            } else if (key === 'textContent') {
                element.textContent = value;
            } else if (key.startsWith('data-')) {
                element.setAttribute(key, value);
            } else {
                element[key] = value;
            }
        });
        
        // Ajouter les enfants
        children.forEach(child => {
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        });
        
        return element;
    }

    /**
     * Animer un élément avec CSS
     */
    static animate(element, animation, duration = 300) {
        return new Promise(resolve => {
            element.style.animation = `${animation} ${duration}ms ease`;
            
            const handleAnimationEnd = () => {
                element.style.animation = '';
                element.removeEventListener('animationend', handleAnimationEnd);
                resolve();
            };
            
            element.addEventListener('animationend', handleAnimationEnd);
        });
    }

    /**
     * Faire défiler vers un élément
     */
    static scrollToElement(element, behavior = 'smooth') {
        element.scrollIntoView({
            behavior,
            block: 'nearest',
            inline: 'nearest'
        });
    }

    /**
     * Vérifier si un élément est visible dans le viewport
     */
    static isElementVisible(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    /**
     * Obtenir les dimensions de l'écran
     */
    static getScreenInfo() {
        return {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1,
            orientation: window.orientation || 0,
            isMobile: window.innerWidth <= 768,
            isTablet: window.innerWidth > 768 && window.innerWidth <= 1024,
            isDesktop: window.innerWidth > 1024
        };
    }

    /**
     * Logger personnalisé avec niveaux
     */
    static createLogger(prefix = 'FileOptimizer') {
        const logLevels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
        
        const currentLevel = logLevels[localStorage.getItem('logLevel')] ?? logLevels.info;
        
        return {
            error: (...args) => {
                if (currentLevel >= logLevels.error) {
                    console.error(`[${prefix}]`, ...args);
                }
            },
            warn: (...args) => {
                if (currentLevel >= logLevels.warn) {
                    console.warn(`[${prefix}]`, ...args);
                }
            },
            info: (...args) => {
                if (currentLevel >= logLevels.info) {
                    console.info(`[${prefix}]`, ...args);
                }
            },
            debug: (...args) => {
                if (currentLevel >= logLevels.debug) {
                    console.debug(`[${prefix}]`, ...args);
                }
            }
        };
    }

    /**
     * Gestionnaire d'erreurs global
     */
    static handleError(error, context = 'Unknown') {
        const logger = this.createLogger('ErrorHandler');
        
        logger.error(`Erreur dans ${context}:`, {
            message: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
        });

        // Optionnel : envoyer à un service de monitoring
        if (window.Sentry) {
            window.Sentry.captureException(error, {
                tags: { context },
                extra: { timestamp: new Date().toISOString() }
            });
        }
    }

    /**
     * Retry automatique avec backoff exponentiel
     */
    static async retry(fn, maxAttempts = 3, baseDelay = 1000) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn(attempt);
            } catch (error) {
                lastError = error;
                
                if (attempt === maxAttempts) {
                    throw error;
                }
                
                const delay = baseDelay * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    }
}

// Export pour utilisation dans d'autres modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
} else {
    window.Utils = Utils;
}