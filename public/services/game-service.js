// Global namespace for the Process Defender Game Service
window.gameService = {
    // Game State
    canvas: null,
    ctx: null,
    isRunning: false,
    lastTime: 0,
    startTime: 0,
    startTag: '', 
    score: 0,
    health: 100,
    pressure: 0, // 0 to 100
    level: 1,
    alarmsProcessed: 0, // NEW: Track progress for win condition
    
    // Process Data
    alarmGraph: null, 
    alarmActions: null, 
    allKnownActions: [], 
    currentContextEvent: null,
    
    // Entities & Visuals
    entities: [], 
    particles: [], 
    historyLog: [], 
    
    // Configuration
    colors: {
        background: '#0f0f1a',
        laneGradientTop: '#1a1a2e',
        laneGradientBottom: '#2a2a4e',
        highwayBorder: '#00fff5', 
        decisionLine: '#ff00ff', 
        text: '#ffffff',
        alarmCritical: '#ff0055', 
        alarmHigh: '#ff9900',     
        alarmLow: '#ffff00',      
        nuisance: '#00ff99',      
        hudBg: 'rgba(15, 15, 26, 0.95)',
        logBg: 'rgba(0, 0, 0, 0.6)',
        panelBorder: '#444',
        success: '#00ff00',
        deviation: '#ffff00',
        failure: '#ff0000'
    },
    
    // NEW: Dynamic settings
    baseSpawnRate: 2500, 
    currentSpawnRate: 2500,
    baseFallSpeed: 150,
    currentFallSpeed: 150,
    
    gameSettings: {
        laneCount: 1, 
        decisionZoneY: 0.85 
    },

    sessionLog: [],
    onGameOver: null, // Callback

    init: function(canvasElement, sessions, startTag) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');
        this.startTag = startTag || 'Unknown';
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this._buildGameLogicMap(sessions);
        this.currentContextEvent = this.startTag;
        this._bindControls();
        return this;
    },

    start: function() {
        this.isRunning = true;
        this.score = 0;
        this.health = 100;
        this.pressure = 30; // Start with some pressure
        this.alarmsProcessed = 0;
        this.level = 1;
        
        // Reset Difficulty
        this.currentSpawnRate = this.baseSpawnRate;
        this.currentFallSpeed = this.baseFallSpeed;

        this.entities = [];
        this.particles = [];
        this.sessionLog = [];
        this.historyLog = [];
        
        this.lastTime = performance.now();
        this.startTime = performance.now(); 
        
        // Spawn timer logic
        this.timeSinceLastSpawn = 0;

        this._spawnNextWave();
        requestAnimationFrame((t) => this.loop(t));
    },

    stop: function() {
        this.isRunning = false;
    },

    resize: function() {
        if (!this.canvas) return;
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight || 600;
    },

    loop: function(timestamp) {
        if (!this.isRunning) return;

        const deltaTime = (timestamp - this.lastTime) / 1000; 
        this.lastTime = timestamp;

        this.update(deltaTime);
        this.draw();

        if (this.health <= 0) {
            this.gameOver(false); // Lost
        } else if (this.pressure <= 0 && this.alarmsProcessed > 10) {
            this.gameOver(true); // Won (Stabilized)
        } else {
            requestAnimationFrame((t) => this.loop(t));
        }
    },

    update: function(dt) {
        // 1. Dynamic Difficulty: Increase speed every 10 seconds or 5 alarms
        const timeElapsed = (performance.now() - this.startTime) / 1000;
        this.level = 1 + Math.floor(timeElapsed / 15);
        
        // Speed caps at 3x
        this.currentFallSpeed = this.baseFallSpeed + (this.level * 20); 
        this.currentSpawnRate = Math.max(800, this.baseSpawnRate - (this.level * 300));

        // 2. Spawn Timer
        this.timeSinceLastSpawn += (dt * 1000);
        if (this.timeSinceLastSpawn > this.currentSpawnRate) {
            this._spawnNextWave();
            this.timeSinceLastSpawn = 0;
        }

        // 3. Update Entities
        this.entities.forEach(entity => {
            entity.y += this.currentFallSpeed * dt;
            
            if (entity.y > this.canvas.height) {
                entity.active = false;
                if (!entity.isNuisance) {
                    this._takeDamage(15);
                    this._createExplosion(entity.x, this.canvas.height, this.colors.failure);
                    this._logAction(entity.tag, 'MISSED', 'FAILURE');
                } else {
                    this.score += 50;
                    this._createFloatingText(entity.x, this.canvas.height - 50, "Ignored (+50)", this.colors.nuisance);
                    this._logAction(entity.tag, 'IGNORED', 'SUCCESS');
                    this.alarmsProcessed++;
                    this.pressure = Math.max(0, this.pressure - 2); // Ignoring nuisance helps stabilize
                }
            }
        });

        this.entities = this.entities.filter(e => e.active);

        // 4. Update Particles
        this.particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.life -= dt;
            p.alpha = Math.max(0, p.life);
        });
        this.particles = this.particles.filter(p => p.life > 0);
    },

    draw: function() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const sidebarWidth = 280; 
        const playAreaWidth = w - sidebarWidth;
        const centerX = playAreaWidth / 2;

        // Background & Grid
        ctx.fillStyle = this.colors.background;
        ctx.fillRect(0, 0, w, h);
        this._drawGrid(ctx, playAreaWidth, h);
        this._drawHighway(ctx, centerX, h, 300);

        // Decision Line
        const decisionY = h * this.gameSettings.decisionZoneY;
        ctx.strokeStyle = this.colors.decisionLine;
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 10]);
        ctx.beginPath(); ctx.moveTo(0, decisionY); ctx.lineTo(playAreaWidth, decisionY); ctx.stroke();
        ctx.setLineDash([]);

        // Entities & Particles
        this.entities.forEach(e => this._drawEntity(ctx, e, centerX));
        this.particles.forEach(p => {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.alpha;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1.0;
        });

        // UI
        this._drawHUD(ctx, w, h, sidebarWidth);
        this._drawHistoryLog(ctx, w, h, sidebarWidth);
    },

    handleInput: function(key) {
        if (!this.isRunning || this.entities.length === 0) return;

        // Find the closest entity to the decision line
        const decisionY = this.canvas.height * this.gameSettings.decisionZoneY;
        
        // Sort entities by proximity to decision line (closest first)
        const targets = this.entities.filter(e => e.y < this.canvas.height).sort((a, b) => b.y - a.y);
        if (targets.length === 0) return;

        const target = targets[0];
        const distance = Math.abs(target.y - decisionY);
        
        if (distance < 200) { // Hit window
            let choiceIndex = -1;
            if (key === 'ArrowLeft') choiceIndex = 0;
            if (key === 'ArrowDown') choiceIndex = 1;
            if (key === 'ArrowRight') choiceIndex = 2;

            if (choiceIndex !== -1) {
                this._resolveAction(target, target.options[choiceIndex], choiceIndex);
            }
        }
    },

    _resolveAction: function(entity, option, choiceIndex) {
        entity.active = false; 
        const isCorrect = option.type === 'correct';
        const isDeviation = option.type === 'deviation';
        const fxX = (this.canvas.width - 280) / 2; 
        const fxY = this.canvas.height * this.gameSettings.decisionZoneY;

        if (entity.isNuisance) {
            this._takeDamage(5);
            this._createFloatingText(fxX, fxY, "Ignore Nuisance!", this.colors.failure);
            this._logAction(entity.tag, option.text, 'UNNECESSARY');
        } else if (isCorrect) {
            this.score += 100 + (this.level * 10); // Bonus for higher levels
            this.pressure = Math.max(0, this.pressure - 10); // Big pressure drop
            this.health = Math.min(100, this.health + 5);
            this.alarmsProcessed++;
            this._createExplosion(fxX, fxY, this.colors.success);
            this._createFloatingText(fxX, fxY, "OPTIMAL", this.colors.success);
            this.currentContextEvent = entity.tag;
            this._logAction(entity.tag, option.text, 'SUCCESS');
        } else if (isDeviation) {
            this.score += 20;
            this.pressure += 2;
            this.alarmsProcessed++;
            this._createExplosion(fxX, fxY, this.colors.deviation);
            this._createFloatingText(fxX, fxY, "DEVIATION", this.colors.deviation);
            this._logAction(entity.tag, option.text, 'DEVIATION');
        } else {
            this._takeDamage(15);
            this._createExplosion(fxX, fxY, this.colors.failure);
            this._createFloatingText(fxX, fxY, "WRONG", this.colors.failure);
            this._logAction(entity.tag, option.text, 'FAILURE');
        }
    },

    _logAction: function(event, action, result) {
        this.sessionLog.push({ event, action, result });
        this.historyLog.unshift({ event, action, result, time: new Date() });
        if (this.historyLog.length > 6) this.historyLog.pop();
    },

    _takeDamage: function(amount) {
        this.health -= amount;
        this.pressure = Math.min(100, this.pressure + amount);
    },

    _spawnNextWave: function() {
        const nextAlarmTag = this._predictNextAlarm(this.currentContextEvent);
        const options = this._generateOptionsForAlarm(nextAlarmTag);
        const isNuisance = this._getNuisanceScore(nextAlarmTag) > 70; 

        const w = this.canvas.width - 280; 
        const newEntity = {
            tag: nextAlarmTag,
            y: -100, 
            x: w / 2,
            active: true,
            isNuisance: isNuisance,
            options: options,
            color: isNuisance ? this.colors.nuisance : this.colors.alarmHigh
        };
        this.entities.push(newEntity);
    },

    _drawGrid: function(ctx, w, h) { /* Same as before */ },
    _drawHighway: function(ctx, centerX, h, laneWidth) { /* Same as before */ 
        // Add visual speed effect
        const topWidth = laneWidth * 0.2; 
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, this.colors.laneGradientTop);
        grad.addColorStop(1, this.colors.laneGradientBottom);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.moveTo(centerX - topWidth/2, 0); ctx.lineTo(centerX + topWidth/2, 0);
        ctx.lineTo(centerX + laneWidth/2, h); ctx.lineTo(centerX - laneWidth/2, h); ctx.fill();
        ctx.strokeStyle = this.colors.highwayBorder; ctx.lineWidth = 3; ctx.stroke();
    },
    _drawEntity: function(ctx, entity, centerX) { 
        const width = 220; const height = 70; 
        ctx.save(); ctx.translate(centerX, entity.y);
        ctx.shadowBlur = 20; ctx.shadowColor = entity.color;
        ctx.fillStyle = 'rgba(10, 10, 20, 0.9)'; ctx.strokeStyle = entity.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(-width/2, -height/2, width, height, 8); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center'; ctx.fillText(entity.tag, 0, -15);
        ctx.font = '10px monospace'; ctx.fillStyle = entity.isNuisance ? '#00ff99' : '#ffaa00'; ctx.fillText(entity.isNuisance ? "NUISANCE" : "CRITICAL", 0, 5);
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(`← ${entity.options[0].text.substring(0,12)}`, -width/2 - 10, 0);
        ctx.textAlign = 'center'; ctx.fillText(`↓ ${entity.options[1].text.substring(0,12)}`, 0, height/2 + 15);
        ctx.textAlign = 'left'; ctx.fillText(`${entity.options[2].text.substring(0,12)} →`, width/2 + 10, 0);
        ctx.restore();
    },
    _drawHUD: function(ctx, w, h, sidebarWidth) {
        // Background
        ctx.fillStyle = this.colors.hudBg; ctx.fillRect(0, 0, w - sidebarWidth, 60);
        ctx.strokeStyle = this.colors.panelBorder; ctx.strokeRect(0, 0, w - sidebarWidth, 60);
        
        // Score & Level
        ctx.fillStyle = '#00ff00'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'left';
        ctx.fillText(`SCORE: ${this.score}`, 20, 35);
        ctx.fillStyle = '#00fff5'; ctx.font = '14px monospace';
        ctx.fillText(`RATE: ${this.currentSpawnRate}ms (Lv.${this.level})`, 200, 35);

        // Bars
        const barW = 200;
        // Health
        ctx.fillStyle = '#222'; ctx.fillRect(w - sidebarWidth - barW - 20, 10, barW, 15);
        ctx.fillStyle = this.health > 50 ? '#00ff00' : '#ff0000';
        ctx.fillRect(w - sidebarWidth - barW - 20, 10, barW * (this.health/100), 15);
        ctx.fillStyle = '#fff'; ctx.font = '10px monospace'; ctx.fillText("INTEGRITY", w - sidebarWidth - barW - 20, 10 - 2);

        // Pressure
        ctx.fillStyle = '#222'; ctx.fillRect(w - sidebarWidth - barW - 20, 35, barW, 15);
        ctx.fillStyle = this.pressure < 50 ? '#00ff99' : '#ff0055';
        ctx.fillRect(w - sidebarWidth - barW - 20, 35, barW * (this.pressure/100), 15);
        ctx.fillStyle = '#fff'; ctx.fillText("PRESSURE (Reduce to 0 to Win)", w - sidebarWidth - barW - 20, 35 - 2);
    },
    _drawHistoryLog: function(ctx, w, h, sidebarWidth) { /* Same as before */
         const startX = w - sidebarWidth;
        ctx.fillStyle = '#111'; ctx.fillRect(startX, 0, sidebarWidth, h);
        ctx.strokeStyle = this.colors.panelBorder; ctx.beginPath(); ctx.moveTo(startX, 0); ctx.lineTo(startX, h); ctx.stroke();
        ctx.fillStyle = '#222'; ctx.fillRect(startX, 0, sidebarWidth, 60);
        ctx.fillStyle = '#00fff5'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center'; ctx.fillText('SYSTEM LOG', startX + sidebarWidth/2, 35);
        let y = 80; ctx.textAlign = 'left'; ctx.font = '12px monospace';
        this.historyLog.forEach(entry => {
            const color = entry.result === 'SUCCESS' ? this.colors.success : (entry.result === 'DEVIATION' ? this.colors.deviation : this.colors.failure);
            ctx.fillStyle = '#1a1a1a'; ctx.fillRect(startX + 10, y, sidebarWidth - 20, 55);
            ctx.strokeStyle = '#333'; ctx.strokeRect(startX + 10, y, sidebarWidth - 20, 55);
            ctx.fillStyle = '#fff'; ctx.fillText(entry.event.substring(0, 20), startX + 20, y + 20); 
            ctx.fillStyle = '#aaa'; ctx.fillText(`→ ${entry.action.substring(0, 20)}`, startX + 20, y + 40); 
            ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.fillText(entry.result, startX + sidebarWidth - 20, y + 30); ctx.textAlign = 'left';
            y += 65;
        });
    },
    _createExplosion: function(x, y, color) { /* Same as before */ 
        for(let i=0; i<15; i++) {
            this.particles.push({
                x: x, y: y, vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 1.2) * 15,
                life: 1.0, color: color, size: Math.random() * 4 + 2
            });
        }
    },
    _createFloatingText: function(x, y, text, color) { /* Same as before */ },
    _bindControls: function() {
        window.addEventListener('keydown', (e) => {
            if (['ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(e.key)) {
                e.preventDefault(); this.handleInput(e.key);
            }
        });
    },
    _buildGameLogicMap: function(sessions) { /* Same as before */ 
        this.alarmGraph = new Map(); this.alarmActions = new Map(); this.allKnownActions = new Set();
        sessions.forEach(session => {
            let lastAlarm = null;
            for (let i = 0; i < session.events.length; i++) {
                const curr = session.events[i];
                if (curr.isAlarm) {
                    if (lastAlarm) {
                        if (!this.alarmGraph.has(lastAlarm)) this.alarmGraph.set(lastAlarm, []);
                        const links = this.alarmGraph.get(lastAlarm);
                        const existing = links.find(t => t.tag === curr.tag);
                        if (existing) existing.freq++; else links.push({ tag: curr.tag, freq: 1 });
                    }
                    lastAlarm = curr.tag;
                } else if (curr.isChange) {
                    this.allKnownActions.add(curr.tag);
                    if (lastAlarm) {
                        if (!this.alarmActions.has(lastAlarm)) this.alarmActions.set(lastAlarm, []);
                        const actions = this.alarmActions.get(lastAlarm);
                        const existing = actions.find(a => a.tag === curr.tag);
                        if (existing) existing.freq++; else actions.push({ tag: curr.tag, freq: 1 });
                    }
                }
            }
        });
        if (this.allKnownActions.size < 3) {
            ["MANUAL", "STOP", "ACK", "RESET"].forEach(a => this.allKnownActions.add(a));
        }
    },
    _predictNextAlarm: function(currentAlarmTag) { /* Same as before */ 
        if (!this.alarmGraph.has(currentAlarmTag)) {
            const keys = Array.from(this.alarmGraph.keys());
            if (keys.length === 0) return this.startTag;
            return keys[Math.floor(Math.random() * keys.length)];
        }
        const possibilities = this.alarmGraph.get(currentAlarmTag);
        const totalFreq = possibilities.reduce((sum, p) => sum + p.freq, 0);
        let random = Math.random() * totalFreq;
        for (const p of possibilities) {
            random -= p.freq; if (random <= 0) return p.tag;
        }
        return possibilities[0].tag;
    },
    _generateOptionsForAlarm: function(alarmTag) { /* Same as before */ 
         let correctAction = { text: "ACKNOWLEDGE", type: 'correct' };
        let deviationAction = { text: "CHECK", type: 'deviation' };
        if (this.alarmActions.has(alarmTag)) {
            const actions = this.alarmActions.get(alarmTag);
            const sorted = [...actions].sort((a, b) => b.freq - a.freq);
            if (sorted.length > 0) correctAction = { text: sorted[0].tag, type: 'correct' };
            if (sorted.length > 1) deviationAction = { text: sorted[1].tag, type: 'deviation' };
            else deviationAction = { text: this._getRandomRealAction(correctAction.text), type: 'deviation' };
        } else {
             deviationAction = { text: this._getRandomRealAction(correctAction.text), type: 'deviation' };
        }
        const noiseText = this._getRandomRealAction([correctAction.text, deviationAction.text]);
        const options = [correctAction, deviationAction, { text: noiseText, type: 'noise' }];
        for (let i = options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [options[i], options[j]] = [options[j], options[i]];
        }
        return options;
    },
    _getRandomRealAction: function(exclude) { /* Same as before */ 
        const actions = Array.from(this.allKnownActions);
        if (actions.length === 0) return "IGNORE";
        let randomAction; let attempts = 0;
        do { randomAction = actions[Math.floor(Math.random() * actions.length)]; attempts++; } 
        while ((Array.isArray(exclude) ? exclude.includes(randomAction) : randomAction === exclude) && attempts < 10);
        return randomAction;
    },
    _getNuisanceScore: function(tag) { return Math.random() * 100; },

    gameOver: function(won) {
        this.isRunning = false;
        const duration = (performance.now() - this.startTime) / 1000;
        const report = {
            start_tag: this.startTag, 
            user_moves: this.sessionLog, 
            score: this.score,
            survived: won, // True if pressure dropped to 0
            duration: duration,
            moves: this.sessionLog.length,
            finalNuisance: this.pressure
        };
        console.log('Game Over Report:', report);
        if (this.onGameOver) this.onGameOver(report);
    }
};