// js/ui.js
// Gestionnaire de l'interface utilisateur

/**
 * Gestionnaire de l'interface utilisateur
 */
class UIManager {
    constructor() {
        this.elements = this.getElements();
        this.logger = Utils.createLogger('UIManager');
        this.setupUI();
    }

    /**
     * Récupérer les éléments DOM
     */
    getElements() {
        return {
            uploadZone: document.getElementById('uploadZone'),
            fileInput: document.getElementById('fileInput'),
            settingsPanel: document.getElementById('settingsPanel'),
            settingsGrid: document.getElementById('settingsGrid'),
            jobsList: document.getElementById('jobsList'),
            statusIndicator: document.getElementById('statusIndicator'),
            statusMessage: document.getElementById('statusMessage'),
            statusIcon: document.getElementById('statusIcon'),
            statusClose: document.getElementById('statusClose'),
            connectionStatus: document.getElementById('connectionStatus'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            refreshJobs: document.getElementById('refreshJobs'),
            clearCompleted: document.getElementById('clearCompleted')
        };
    }

    /**
     * Configuration initiale de l'UI
     */
    setupUI() {
        this.logger.info('Initialisation UI Manager');
        
        // Configuration des tooltips
        this.setupTooltips();
        
        // Configuration des animations
        this.setupAnimations();
        
        // Configuration des raccourcis
        this.setupKeyboardShortcuts();
        
        // État initial
        this.setLoadingState(false);
        this.setConnectionStatus(false);
    }

    /**
     * Afficher un message de statut
     */
    showStatus(message, type = 'info', duration = 3000) {
        const { statusIndicator, statusMessage, statusIcon } = this.elements;
        
        if (!statusIndicator || !statusMessage || !statusIcon) {
            console.warn('Éléments de statut non trouvés');
            return;
        }

        // Icônes selon le type
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        statusIcon.textContent = icons[type] || icons.info;
        statusMessage.textContent = message;
        
        // Classes CSS
        statusIndicator.className = `status-indicator show ${type}`;
        
        // Animation d'entrée
        statusIndicator.style.transform = 'translateX(100%)';
        statusIndicator.style.opacity = '0';
        
        requestAnimationFrame(() => {
            statusIndicator.style.transform = 'translateX(0)';
            statusIndicator.style.opacity = '1';
        });

        // Auto-masquage
        if (duration > 0) {
            setTimeout(() => {
                this.hideStatus();
            }, duration);
        }

        this.logger.debug(`Status affiché: ${type} - ${message}`);
    }

    /**
     * Masquer le message de statut
     */
    hideStatus() {
        const { statusIndicator } = this.elements;
        
        if (statusIndicator) {
            statusIndicator.style.transform = 'translateX(100%)';
            statusIndicator.style.opacity = '0';
            
            setTimeout(() => {
                statusIndicator.classList.remove('show');
            }, 300);
        }
    }

    /**
     * Définir l'état de connexion
     */
    setConnectionStatus(connected) {
        const { connectionStatus } = this.elements;
        
        if (!connectionStatus) return;

        if (connected) {
            connectionStatus.className = 'connection-status connected';
            connectionStatus.innerHTML = '<div class="connection-dot"></div><span>Connecté</span>';
        } else {
            connectionStatus.className = 'connection-status disconnected';
            connectionStatus.innerHTML = '<div class="connection-dot"></div><span>Déconnecté</span>';
        }
    }

    /**
     * Définir l'état de chargement global
     */
    setLoadingState(loading) {
        const { loadingOverlay } = this.elements;
        
        if (!loadingOverlay) return;

        if (loading) {
            loadingOverlay.classList.add('show');
        } else {
            loadingOverlay.classList.remove('show');
        }
    }

    /**
     * Définir l'état de la zone d'upload
     */
    setUploadZoneState(state) {
        const { uploadZone } = this.elements;
        
        if (!uploadZone) return;

        uploadZone.classList.remove('dragover', 'uploading');
        
        if (state === 'dragover') {
            uploadZone.classList.add('dragover');
        } else if (state === 'uploading') {
            uploadZone.classList.add('uploading');
        }
    }

    /**
     * Rendre la liste des jobs
     */
    renderJobs(jobs) {
        const { jobsList } = this.elements;
        
        if (!jobsList) {
            this.logger.error('Element jobsList non trouvé');
            return;
        }

        if (!jobs || jobs.length === 0) {
            jobsList.innerHTML = this.renderEmptyState();
            return;
        }

        // Trier par date de création (plus récent en premier)
        const sortedJobs = jobs.sort((a, b) => 
            new Date(b.createdAt) - new Date(a.createdAt)
        );

        jobsList.innerHTML = sortedJobs.map(job => this.renderJob(job)).join('');
        
        // Animer les nouveaux éléments
        this.animateJobItems();
    }

    /**
     * Rendre un job individuel
     */
    renderJob(job) {
        const statusClass = `status-${job.status}`;
        const statusText = this.getStatusText(job.status);
        const progressPercent = Math.max(0, Math.min(100, job.progress || 0));
        const showProgress = ['processing', 'queued'].includes(job.status);
        
        // Informations de taille et compression
        const sizeInfo = this.renderSizeInfo(job);
        
        // Actions disponibles
        const actions = this.renderJobActions(job);
        
        // Temps relatif
        const timeAgo = Utils.formatRelativeTime(job.createdAt);
        
        // Icône du type de fichier
        const fileIcon = Utils.getFileIcon(job.type);

        return `
            <div class="job-item" data-job-id="${job.id}" data-status="${job.status}">
                <div class="job-header">
                    <div class="job-name" title="${Utils.escapeHtml(job.name)}">
                        ${fileIcon} ${Utils.escapeHtml(job.name)}
                    </div>
                    <div class="job-status ${statusClass}">${statusText}</div>
                </div>
                
                ${showProgress ? `
                    <div class="job-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        <div class="progress-text">
                            ${progressPercent}% complété
                            ${job.estimatedTime && job.status === 'processing' ? 
                                `• ETA: ${Utils.formatDuration(job.estimatedTime * 1000)}` : ''}
                        </div>
                    </div>
                ` : ''}

                <div class="job-info">
                    <div><strong>Type:</strong> ${job.type}</div>
                    <div><strong>Créé:</strong> ${timeAgo}</div>
                    ${sizeInfo}
                    ${job.error ? `<div class="job-error"><strong>Erreur:</strong> ${Utils.escapeHtml(job.error)}</div>` : ''}
                </div>

                ${actions ? `<div class="job-actions">${actions}</div>` : ''}
            </div>
        `;
    }

    /**
     * Rendre les informations de taille
     */
    renderSizeInfo(job) {
        let sizeInfo = `<div><strong>Taille:</strong> ${Utils.formatFileSize(job.size)}</div>`;
        
        if (job.compressedSize && job.status === 'completed') {
            const ratio = Utils.calculateCompressionRatio(job.size, job.compressedSize);
            const saved = job.size - job.compressedSize;
            
            sizeInfo += `
                <div><strong>Compressé:</strong> ${Utils.formatFileSize(job.compressedSize)}</div>
                <div><strong>Économisé:</strong> ${Utils.formatFileSize(saved)} (${ratio}%)</div>
            `;
        }
        
        return sizeInfo;
    }

    /**
     * Rendre les actions disponibles pour un job
     */
    renderJobActions(job) {
        const actions = [];

        switch (job.status) {
            case 'completed':
                actions.push(`
                    <button class="btn btn-success" onclick="downloadFile('${job.id}')" title="Télécharger le fichier optimisé">
                        📥 Télécharger
                    </button>
                `);
                actions.push(`
                    <button class="btn btn-secondary" onclick="deleteJob('${job.id}')" title="Supprimer ce job">
                        🗑️ Supprimer
                    </button>
                `);
                break;

            case 'error':
                actions.push(`
                    <button class="btn btn-primary" onclick="retryJob('${job.id}')" title="Relancer le traitement">
                        🔄 Relancer
                    </button>
                `);
                actions.push(`
                    <button class="btn btn-secondary" onclick="deleteJob('${job.id}')" title="Supprimer ce job">
                        🗑️ Supprimer
                    </button>
                `);
                break;

            case 'processing':
            case 'queued':
                actions.push(`
                    <button class="btn btn-secondary" onclick="cancelJob('${job.id}')" title="Annuler le traitement">
                        ⏹️ Annuler
                    </button>
                `);
                break;

            case 'uploaded':
                actions.push(`
                    <button class="btn btn-primary" onclick="startProcessing('${job.id}')" title="Démarrer le traitement">
                        ▶️ Traiter
                    </button>
                `);
                actions.push(`
                    <button class="btn btn-secondary" onclick="deleteJob('${job.id}')" title="Supprimer ce job">
                        🗑️ Supprimer
                    </button>
                `);
                break;
        }

        return actions.join('');
    }

    /**
     * Rendre l'état vide
     */
    renderEmptyState() {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">
                    📁
                </div>
                <div>Aucun fichier en cours de traitement</div>
                <div style="font-size: 0.9rem; margin-top: 0.5rem; color: var(--text-muted);">
                    Glissez des fichiers dans la zone d'upload pour commencer
                </div>
            </div>
        `;
    }

    /**
     * Obtenir le texte de statut
     */
    getStatusText(status) {
        const statusTexts = {
            uploaded: 'Uploadé',
            queued: 'En attente',
            processing: 'Traitement',
            completed: 'Terminé',
            error: 'Erreur',
            cancelled: 'Annulé',
            paused: 'En pause'
        };
        
        return statusTexts[status] || status;
    }

    /**
     * Animer les éléments de job
     */
    animateJobItems() {
        const jobItems = document.querySelectorAll('.job-item');
        
        jobItems.forEach((item, index) => {
            item.style.opacity = '0';
            item.style.transform = 'translateY(20px)';
            
            setTimeout(() => {
                item.style.transition = 'all 0.3s ease';
                item.style.opacity = '1';
                item.style.transform = 'translateY(0)';
            }, index * 50);
        });
    }

    /**
     * Mettre à jour un job spécifique dans la liste
     */
    updateJobInList(jobId, updates) {
        const jobElement = document.querySelector(`[data-job-id="${jobId}"]`);
        
        if (!jobElement) return;

        // Mettre à jour le statut
        if (updates.status) {
            jobElement.dataset.status = updates.status;
            const statusElement = jobElement.querySelector('.job-status');
            if (statusElement) {
                statusElement.textContent = this.getStatusText(updates.status);
                statusElement.className = `job-status status-${updates.status}`;
            }
        }

        // Mettre à jour la progression
        if (updates.progress !== undefined) {
            const progressFill = jobElement.querySelector('.progress-fill');
            const progressText = jobElement.querySelector('.progress-text');
            
            if (progressFill) {
                progressFill.style.width = `${updates.progress}%`;
            }
            if (progressText) {
                progressText.textContent = `${updates.progress}% complété`;
            }
        }

        // Animation de mise à jour
        jobElement.style.transform = 'scale(1.02)';
        setTimeout(() => {
            jobElement.style.transform = 'scale(1)';
        }, 200);
    }

    /**
     * Configuration des tooltips
     */
    setupTooltips() {
        // Implémentation simple de tooltips
        document.addEventListener('mouseover', (e) => {
            if (e.target.hasAttribute('title')) {
                this.showTooltip(e.target, e.target.getAttribute('title'));
            }
        });

        document.addEventListener('mouseout', (e) => {
            if (e.target.hasAttribute('title')) {
                this.hideTooltip();
            }
        });
    }

    /**
     * Afficher un tooltip
     */
    showTooltip(element, text) {
        const tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.textContent = text;
        tooltip.style.cssText = `
            position: absolute;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 1000;
            pointer-events: none;
        `;
        document.body.appendChild(tooltip);

        const rect = element.getBoundingClientRect();
        tooltip.style.left = rect.left + rect.width / 2 - tooltip.offsetWidth / 2 + 'px';
        tooltip.style.top = rect.bottom + 8 + 'px';
    }

    /**
     * Masquer le tooltip
     */
    hideTooltip() {
        const tooltip = document.querySelector('.tooltip');
        if (tooltip) {
            tooltip.remove();
        }
    }

    /**
     * Configuration des animations
     */
    setupAnimations() {
        // Observer pour les animations d'apparition
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.style.opacity = '1';
                        entry.target.style.transform = 'translateY(0)';
                    }
                });
            });

            // Observer les éléments avec classe animate-on-scroll
            document.querySelectorAll('.animate-on-scroll').forEach(el => {
                observer.observe(el);
            });
        }
    }

    /**
     * Configuration des raccourcis clavier
     */
    setupKeyboardShortcuts() {
        // Les raccourcis sont déjà gérés dans app.js
        // Ici on peut ajouter des indicateurs visuels
    }

    /**
     * Nettoyer les ressources UI
     */
    destroy() {
        // Nettoyer les événements et timers
        this.hideStatus();
        this.hideTooltip();
        this.logger.info('UIManager détruit');
    }
}

// Export pour utilisation dans d'autres modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIManager;
} else {
    window.UIManager = UIManager;
}