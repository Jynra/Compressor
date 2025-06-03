// js/app.js
// Application principale File Optimizer

/**
 * Classe principale de l'application File Optimizer
 */
class FileOptimizer {
    constructor() {
        this.jobs = new Map();
        this.socket = null;
        this.api = null;
        this.ui = null;
        this.websocket = null;
        this.isInitialized = false;
        this.retryInitCount = 0;
        this.maxRetryInit = 3;
        
        this.config = {
            maxFileSize: 5 * 1024 * 1024 * 1024, // 5GB
            supportedTypes: ['image', 'video', 'audio', 'document'],
            apiEndpoint: window.location.origin + '/api',
            maxConcurrentUploads: 3
        };
        
        this.uploadQueue = [];
        this.activeUploads = 0;
        
        this.init();
    }

    /**
     * Initialiser l'application
     */
    async init() {
        try {
            console.log('🚀 Initialisation File Optimizer');
            
            // ✅ FIX: Vérifier les dépendances avant l'initialisation
            if (!this.checkDependencies()) {
                throw new Error('Dépendances manquantes');
            }

            // Initialiser les modules avec gestion d'erreur
            await this.initializeModules();
            
            // Configuration des événements
            this.setupEventListeners();
            this.setupWebSocketEvents();
            
            // Charger les données existantes
            await this.loadApplicationData();
            
            // Marquer comme prêt
            this.ui.setLoadingState(false);
            this.ui.showStatus('Application prête', 'success');
            this.isInitialized = true;
            
            console.log('✅ File Optimizer initialisé');
            
        } catch (error) {
            console.error('❌ Erreur initialisation:', error);
            await this.handleInitError(error);
        }
    }

    /**
     * ✅ NOUVEAU: Vérifier les dépendances
     */
    checkDependencies() {
        const required = ['Utils', 'ApiClient', 'UIManager', 'WebSocketManager'];
        const missing = required.filter(dep => !window[dep]);
        
        if (missing.length > 0) {
            console.error('Dépendances manquantes:', missing);
            this.showErrorFallback('Modules JavaScript manquants: ' + missing.join(', '));
            return false;
        }
        
        return true;
    }

    /**
     * ✅ NOUVEAU: Initialiser les modules avec gestion d'erreur
     */
    async initializeModules() {
        try {
            this.api = new ApiClient(this.config.apiEndpoint);
            this.ui = new UIManager();
            
            // Test de connectivité avant WebSocket
            const connectivity = await this.api.checkConnectivity();
            if (!connectivity.online) {
                throw new Error('Serveur non accessible');
            }
            
            this.websocket = new WebSocketManager(this.config.apiEndpoint);
            
        } catch (error) {
            console.error('Erreur initialisation modules:', error);
            throw error;
        }
    }

    /**
     * ✅ NOUVEAU: Charger les données de l'application
     */
    async loadApplicationData() {
        const loadPromises = [
            this.loadExistingJobs(),
            this.loadUploadInfo()
        ];

        // Charger en parallèle, continuer même si certaines échouent
        const results = await Promise.allSettled(loadPromises);
        
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                const operations = ['jobs existants', 'infos upload'];
                console.warn(`Échec chargement ${operations[index]}:`, result.reason);
            }
        });
    }

    /**
     * ✅ NOUVEAU: Gérer les erreurs d'initialisation
     */
    async handleInitError(error) {
        this.retryInitCount++;
        
        if (this.retryInitCount < this.maxRetryInit) {
            console.log(`Tentative de ré-initialisation ${this.retryInitCount}/${this.maxRetryInit}`);
            
            setTimeout(() => {
                this.init();
            }, 2000 * this.retryInitCount);
        } else {
            this.showErrorFallback('Échec d\'initialisation après plusieurs tentatives');
        }
    }

    /**
     * ✅ NOUVEAU: Afficher une interface d'erreur fallback
     */
    showErrorFallback(message) {
        document.body.innerHTML = `
            <div style="
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: #1e293b; color: #f8fafc; padding: 2rem; border-radius: 12px;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3); text-align: center;
                max-width: 400px; border: 1px solid #334155;
            ">
                <h2 style="color: #ef4444; margin-bottom: 1rem;">❌ Erreur Application</h2>
                <p style="margin-bottom: 1rem;">${message}</p>
                <button onclick="window.location.reload()" style="
                    background: #2563eb; color: white; border: none; padding: 0.5rem 1rem;
                    border-radius: 6px; cursor: pointer; font-size: 0.9rem;
                ">Recharger la page</button>
            </div>
        `;
    }

    /**
     * Configuration des événements DOM
     */
    setupEventListeners() {
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        const refreshJobs = document.getElementById('refreshJobs');
        const clearCompleted = document.getElementById('clearCompleted');

        // ✅ FIX: Vérifier l'existence des éléments
        if (!uploadZone || !fileInput) {
            console.error('Éléments DOM requis non trouvés');
            return;
        }

        // Upload zone drag & drop
        uploadZone.addEventListener('click', () => fileInput.click());
        uploadZone.addEventListener('dragover', this.handleDragOver.bind(this));
        uploadZone.addEventListener('dragleave', this.handleDragLeave.bind(this));
        uploadZone.addEventListener('drop', this.handleDrop.bind(this));

        // File input change
        fileInput.addEventListener('change', (e) => {
            this.handleFiles(Array.from(e.target.files));
            // ✅ FIX: Reset input pour permettre re-sélection du même fichier
            e.target.value = '';
        });

        // Boutons de contrôle
        if (refreshJobs) {
            refreshJobs.addEventListener('click', () => this.loadExistingJobs());
        }
        
        if (clearCompleted) {
            clearCompleted.addEventListener('click', () => this.clearCompletedJobs());
        }

        // Fermeture notifications
        document.addEventListener('click', (e) => {
            if (e.target.id === 'statusClose') {
                this.ui.hideStatus();
            }
        });

        // ✅ FIX: Gestion globale des erreurs click
        document.addEventListener('click', (e) => {
            // Gérer les actions sur les jobs même si l'app n'est pas initialisée
            const action = e.target.dataset.action;
            const jobId = e.target.dataset.jobId;
            
            if (action && jobId && this.isInitialized) {
                e.preventDefault();
                this.handleJobAction(action, jobId);
            }
        });

        // Raccourcis clavier
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'u': // Ctrl+U pour upload
                        e.preventDefault();
                        fileInput.click();
                        break;
                    case 'r': // Ctrl+R pour refresh
                        if (e.shiftKey) {
                            e.preventDefault();
                            this.loadExistingJobs();
                        }
                        break;
                }
            }
        });
    }

    /**
     * ✅ NOUVEAU: Gérer les actions sur les jobs
     */
    async handleJobAction(action, jobId) {
        try {
            switch (action) {
                case 'delete':
                    await this.deleteJob(jobId);
                    break;
                case 'retry':
                    await this.retryJob(jobId);
                    break;
                case 'download':
                    await this.downloadFile(jobId);
                    break;
                case 'cancel':
                    await this.cancelJob(jobId);
                    break;
                default:
                    console.warn('Action inconnue:', action);
            }
        } catch (error) {
            console.error(`Erreur action ${action}:`, error);
            this.ui.showStatus(`Erreur ${action}: ${error.message}`, 'error');
        }
    }

    /**
     * Configuration des événements WebSocket
     */
    setupWebSocketEvents() {
        if (!this.websocket) return;

        this.websocket.on('connect', () => {
            this.ui.setConnectionStatus(true);
            console.log('🔌 WebSocket connecté');
        });

        this.websocket.on('disconnect', () => {
            this.ui.setConnectionStatus(false);
            console.log('🔌 WebSocket déconnecté');
        });

        this.websocket.on('job-progress', (data) => {
            this.updateJobProgress(data.jobId, data.progress);
        });

        this.websocket.on('job-completed', (data) => {
            this.updateJobStatus(data.jobId, 'completed', data);
        });

        this.websocket.on('job-error', (data) => {
            this.updateJobStatus(data.jobId, 'error', { error: data.error });
        });

        this.websocket.on('job-queued', (data) => {
            this.updateJobStatus(data.jobId, 'queued');
        });

        // ✅ NOUVEAU: Gestion des événements système
        this.websocket.on('server-shutdown', (data) => {
            this.ui.showStatus('Serveur en maintenance', 'warning', 10000);
        });

        this.websocket.on('max-reconnect-attempts', () => {
            this.ui.showStatus('Connexion perdue. Veuillez recharger la page.', 'error', 0);
        });
    }

    /**
     * Gestion drag & drop
     */
    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        this.ui.setUploadZoneState('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        this.ui.setUploadZoneState('normal');
    }

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this.ui.setUploadZoneState('normal');
        
        const files = Array.from(e.dataTransfer.files);
        this.handleFiles(files);
    }

    /**
     * Traitement des fichiers sélectionnés
     */
    async handleFiles(files) {
        if (files.length === 0) return;

        console.log(`📁 ${files.length} fichier(s) sélectionné(s)`);
        
        // Valider les fichiers
        const validFiles = files.filter(file => this.validateFile(file));
        
        if (validFiles.length !== files.length) {
            this.ui.showStatus(
                `${files.length - validFiles.length} fichier(s) rejeté(s) (type non supporté ou trop volumineux)`,
                'warning'
            );
        }

        // ✅ FIX: Traitement par lots pour éviter la surcharge
        if (validFiles.length > this.config.maxConcurrentUploads) {
            this.uploadQueue.push(...validFiles);
            this.processUploadQueue();
        } else {
            // Traiter les fichiers valides
            for (const file of validFiles) {
                try {
                    await this.uploadFile(file);
                } catch (error) {
                    console.error(`Erreur upload ${file.name}:`, error);
                }
            }
        }
    }

    /**
     * ✅ NOUVEAU: Traiter la queue d'upload
     */
    async processUploadQueue() {
        while (this.uploadQueue.length > 0 && this.activeUploads < this.config.maxConcurrentUploads) {
            const file = this.uploadQueue.shift();
            this.activeUploads++;
            
            this.uploadFile(file)
                .catch(error => console.error(`Erreur upload ${file.name}:`, error))
                .finally(() => {
                    this.activeUploads--;
                    this.processUploadQueue(); // Traiter le suivant
                });
        }
    }

    /**
     * Validation d'un fichier
     */
    validateFile(file) {
        // ✅ FIX: Validation plus robuste
        if (!file || !file.name) {
            console.warn('Fichier invalide');
            return false;
        }

        if (file.size === 0) {
            console.warn(`Fichier vide: ${file.name}`);
            return false;
        }

        // Vérifier la taille
        if (file.size > this.config.maxFileSize) {
            console.warn(`Fichier trop volumineux: ${file.name} (${Utils.formatFileSize(file.size)})`);
            return false;
        }

        // Vérifier le type
        const fileType = Utils.getFileType(file.name);
        if (!this.config.supportedTypes.includes(fileType)) {
            console.warn(`Type non supporté: ${file.name} (${fileType})`);
            return false;
        }

        return true;
    }

    /**
     * Upload d'un fichier
     */
    async uploadFile(file) {
        try {
            this.ui.showStatus(`Upload de ${file.name}...`, 'info');

            // Déterminer les paramètres par défaut
            const fileType = Utils.getFileType(file.name);
            const settings = this.getDefaultSettings(fileType);

            // Créer le job temporaire
            const tempJob = {
                id: 'temp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
                name: file.name,
                size: file.size,
                type: fileType,
                status: 'uploading',
                progress: 0,
                createdAt: new Date().toISOString()
            };

            this.addJob(tempJob);

            // Upload via API
            const result = await this.api.uploadFile(file, settings);

            if (result.success) {
                // Remplacer le job temporaire par le vrai
                this.jobs.delete(tempJob.id);
                
                const job = {
                    id: result.jobId,
                    name: file.name,
                    size: file.size,
                    type: fileType,
                    status: 'uploaded',
                    progress: 0,
                    settings: settings,
                    createdAt: new Date().toISOString(),
                    estimatedTime: result.estimatedTime
                };

                this.addJob(job);
                
                // ✅ FIX: Vérifier que WebSocket est connecté avant join
                if (this.websocket && this.websocket.isConnected) {
                    this.websocket.joinJobRoom(result.jobId);
                }
                
                this.ui.showStatus(`${file.name} uploadé avec succès!`, 'success');
                
            } else {
                this.jobs.delete(tempJob.id);
                throw new Error(result.error || 'Erreur upload');
            }

        } catch (error) {
            console.error('Erreur upload:', error);
            this.ui.showStatus(`Erreur upload ${file.name}: ${error.message}`, 'error');
        }
    }

    /**
     * Obtenir les paramètres par défaut selon le type
     */
    getDefaultSettings(type) {
        const defaultSettings = {
            image: {
                quality: 80,
                maxWidth: 1920,
                maxHeight: 1080,
                format: 'auto',
                removeMetadata: true
            },
            video: {
                codec: 'h264',
                crf: 23,
                preset: 'medium',
                maxBitrate: '2M'
            },
            audio: {
                codec: 'aac',
                bitrate: '128k',
                sampleRate: 44100
            },
            document: {
                compress: true,
                removeMetadata: true
            }
        };

        return defaultSettings[type] || {};
    }

    /**
     * Ajouter un job à la liste
     */
    addJob(job) {
        this.jobs.set(job.id, job);
        this.ui.renderJobs(Array.from(this.jobs.values()));
    }

    /**
     * Mettre à jour la progression d'un job
     */
    updateJobProgress(jobId, progress) {
        const job = this.jobs.get(jobId);
        if (job) {
            job.progress = Math.min(100, Math.max(0, progress)); // ✅ FIX: Clamp la progression
            job.status = 'processing';
            this.ui.renderJobs(Array.from(this.jobs.values()));
            
            console.log(`📊 Job ${jobId}: ${progress}%`);
        }
    }

    /**
     * Mettre à jour le statut d'un job
     */
    updateJobStatus(jobId, status, data = {}) {
        const job = this.jobs.get(jobId);
        if (job) {
            job.status = status;
            Object.assign(job, data);
            this.ui.renderJobs(Array.from(this.jobs.values()));

            if (status === 'completed') {
                this.ui.showStatus(`${job.name} traité avec succès!`, 'success');
                console.log(`✅ Job ${jobId} terminé`);
            } else if (status === 'error') {
                this.ui.showStatus(`Erreur traitement ${job.name}: ${data.error}`, 'error');
                console.error(`❌ Job ${jobId} échoué:`, data.error);
            }
        }
    }

    /**
     * Supprimer un job
     */
    async deleteJob(jobId) {
        try {
            // ✅ FIX: Validation des paramètres
            if (!jobId) {
                throw new Error('Job ID manquant');
            }

            const job = this.jobs.get(jobId);
            if (!job) {
                throw new Error('Job non trouvé');
            }

            const confirmed = confirm(`Supprimer ${job.name} ?`);
            if (!confirmed) return;

            this.ui.setLoadingState(true);
            
            const result = await this.api.deleteJob(jobId);
            
            if (result.success) {
                this.jobs.delete(jobId);
                this.ui.renderJobs(Array.from(this.jobs.values()));
                this.ui.showStatus('Fichier supprimé', 'success');
            } else {
                throw new Error(result.error || 'Erreur suppression');
            }
        } catch (error) {
            console.error('Erreur suppression:', error);
            this.ui.showStatus('Erreur suppression: ' + error.message, 'error');
        } finally {
            this.ui.setLoadingState(false);
        }
    }

    /**
     * Retenter un job en erreur
     */
    async retryJob(jobId) {
        try {
            if (!jobId) {
                throw new Error('Job ID manquant');
            }

            this.ui.setLoadingState(true);
            
            const result = await this.api.retryJob(jobId);
            
            if (result.success) {
                this.updateJobStatus(jobId, 'queued');
                
                // ✅ FIX: Vérifier WebSocket avant join
                if (this.websocket && this.websocket.isConnected) {
                    this.websocket.joinJobRoom(jobId);
                }
                
                this.ui.showStatus('Job relancé', 'success');
            } else {
                throw new Error(result.error || 'Erreur retry');
            }
        } catch (error) {
            console.error('Erreur retry:', error);
            this.ui.showStatus('Erreur retry: ' + error.message, 'error');
        } finally {
            this.ui.setLoadingState(false);
        }
    }

    /**
     * ✅ NOUVEAU: Annuler un job
     */
    async cancelJob(jobId) {
        try {
            if (!jobId) {
                throw new Error('Job ID manquant');
            }

            const confirmed = confirm('Annuler ce traitement ?');
            if (!confirmed) return;

            this.ui.setLoadingState(true);
            
            const result = await this.api.cancelJob(jobId);
            
            if (result.success) {
                this.updateJobStatus(jobId, 'cancelled');
                this.ui.showStatus('Job annulé', 'success');
            } else {
                throw new Error(result.error || 'Erreur annulation');
            }
        } catch (error) {
            console.error('Erreur annulation:', error);
            this.ui.showStatus('Erreur annulation: ' + error.message, 'error');
        } finally {
            this.ui.setLoadingState(false);
        }
    }

    /**
     * Charger les jobs existants
     */
    async loadExistingJobs() {
        try {
            console.log('🔄 Chargement des jobs existants...');
            
            const result = await this.api.getJobs({ limit: 50 });
            
            if (result.success && result.jobs) {
                this.jobs.clear();
                
                result.jobs.forEach(apiJob => {
                    const job = {
                        id: apiJob.id,
                        name: apiJob.originalName,
                        size: apiJob.size,
                        type: apiJob.type,
                        status: apiJob.status,
                        progress: apiJob.progress || 0,
                        createdAt: apiJob.createdAt,
                        compressedSize: apiJob.compressedSize,
                        compressionRatio: apiJob.compressionRatio,
                        error: apiJob.error
                    };
                    
                    this.jobs.set(job.id, job);
                    
                    // Rejoindre les rooms pour les jobs actifs
                    if (['queued', 'processing'].includes(job.status) && 
                        this.websocket && this.websocket.isConnected) {
                        this.websocket.joinJobRoom(job.id);
                    }
                });
                
                this.ui.renderJobs(Array.from(this.jobs.values()));
                console.log(`📋 ${this.jobs.size} job(s) chargé(s)`);
            }
        } catch (error) {
            console.error('Erreur chargement jobs:', error);
            this.ui.showStatus('Erreur chargement jobs', 'error');
        }
    }

    /**
     * Charger les informations d'upload
     */
    async loadUploadInfo() {
        try {
            const info = await this.api.getUploadInfo();
            if (info.success) {
                this.config.maxFileSize = info.limits.maxFileSize;
                console.log('📊 Limites upload:', info.limits);
            }
        } catch (error) {
            console.warn('Impossible de charger les infos upload:', error);
        }
    }

    /**
     * Nettoyer les jobs terminés
     */
    async clearCompletedJobs() {
        try {
            const completedJobs = Array.from(this.jobs.values())
                .filter(job => job.status === 'completed');
            
            if (completedJobs.length === 0) {
                this.ui.showStatus('Aucun job terminé à nettoyer', 'info');
                return;
            }
            
            const confirmed = confirm(`Supprimer ${completedJobs.length} job(s) terminé(s) ?`);
            if (!confirmed) return;
            
            this.ui.setLoadingState(true);
            
            let successCount = 0;
            
            // ✅ FIX: Traitement séquentiel pour éviter la surcharge
            for (const job of completedJobs) {
                try {
                    const result = await this.api.deleteJob(job.id);
                    if (result.success) {
                        this.jobs.delete(job.id);
                        successCount++;
                    }
                } catch (error) {
                    console.error(`Erreur suppression ${job.id}:`, error);
                }
            }
            
            this.ui.renderJobs(Array.from(this.jobs.values()));
            this.ui.showStatus(`${successCount} job(s) supprimé(s)`, 'success');
            
        } catch (error) {
            console.error('Erreur nettoyage:', error);
            this.ui.showStatus('Erreur nettoyage: ' + error.message, 'error');
        } finally {
            this.ui.setLoadingState(false);
        }
    }

    /**
     * Télécharger un fichier traité
     */
    async downloadFile(jobId) {
        try {
            if (!jobId) {
                throw new Error('Job ID manquant');
            }

            const job = this.jobs.get(jobId);
            if (!job || job.status !== 'completed') {
                this.ui.showStatus('Fichier non disponible pour téléchargement', 'warning');
                return;
            }

            // ✅ FIX: Méthode de téléchargement améliorée
            const blob = await this.api.downloadFile(jobId);
            
            // Créer l'URL de téléchargement
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = job.name;
            link.style.display = 'none';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Nettoyer l'URL
            setTimeout(() => window.URL.revokeObjectURL(url), 100);
            
            this.ui.showStatus(`Téléchargement de ${job.name} démarré`, 'success');
        } catch (error) {
            console.error('Erreur téléchargement:', error);
            this.ui.showStatus('Erreur téléchargement: ' + error.message, 'error');
        }
    }

    /**
     * Obtenir les statistiques
     */
    getStats() {
        const jobs = Array.from(this.jobs.values());
        
        return {
            total: jobs.length,
            completed: jobs.filter(j => j.status === 'completed').length,
            processing: jobs.filter(j => j.status === 'processing').length,
            error: jobs.filter(j => j.status === 'error').length,
            totalSize: jobs.reduce((sum, j) => sum + (j.size || 0), 0),
            totalSaved: jobs
                .filter(j => j.compressedSize)
                .reduce((sum, j) => sum + (j.size - j.compressedSize), 0)
        };
    }

    /**
     * ✅ NOUVEAU: Obtenir l'état de l'application
     */
    getApplicationState() {
        return {
            isInitialized: this.isInitialized,
            jobsCount: this.jobs.size,
            activeUploads: this.activeUploads,
            queuedUploads: this.uploadQueue.length,
            websocketConnected: this.websocket?.isConnected || false,
            config: this.config
        };
    }

    /**
     * Nettoyer les ressources
     */
    destroy() {
        if (this.websocket) {
            this.websocket.destroy();
        }
        
        if (this.api) {
            this.api.destroy();
        }
        
        this.jobs.clear();
        this.uploadQueue.length = 0;
        this.isInitialized = false;
        
        console.log('🧹 File Optimizer nettoyé');
    }
}

// ✅ FIX: Fonctions globales sécurisées
window.fileOptimizer = null;

// Wrapper sécurisé pour les actions globales
function safeExecute(action, ...args) {
    if (!window.fileOptimizer || !window.fileOptimizer.isInitialized) {
        console.warn('File Optimizer non initialisé');
        return;
    }
    
    try {
        return window.fileOptimizer[action](...args);
    } catch (error) {
        console.error(`Erreur exécution ${action}:`, error);
    }
}

window.deleteJob = (jobId) => safeExecute('deleteJob', jobId);
window.retryJob = (jobId) => safeExecute('retryJob', jobId);
window.downloadFile = (jobId) => safeExecute('downloadFile', jobId);
window.cancelJob = (jobId) => safeExecute('cancelJob', jobId);

// ✅ FIX: Initialisation sécurisée avec retry
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎯 File Optimizer Frontend v2.0.0');
    
    try {
        window.fileOptimizer = new FileOptimizer();
    } catch (error) {
        console.error('Erreur création FileOptimizer:', error);
        
        // Retry après 2 secondes
        setTimeout(() => {
            try {
                window.fileOptimizer = new FileOptimizer();
            } catch (retryError) {
                console.error('Échec retry FileOptimizer:', retryError);
            }
        }, 2000);
    }
});

// Nettoyage à la fermeture
window.addEventListener('beforeunload', () => {
    if (window.fileOptimizer) {
        window.fileOptimizer.destroy();
    }
});

// ✅ NOUVEAU: Gestionnaire d'erreurs global pour l'app
window.addEventListener('error', (event) => {
    console.error('Erreur JavaScript globale:', event.error);
    
    if (window.fileOptimizer && window.fileOptimizer.ui) {
        window.fileOptimizer.ui.showStatus('Erreur inattendue détectée', 'error');
    }
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Promise rejetée non gérée:', event.reason);
    
    if (window.fileOptimizer && window.fileOptimizer.ui) {
        window.fileOptimizer.ui.showStatus('Erreur async non gérée', 'error');
    }
});