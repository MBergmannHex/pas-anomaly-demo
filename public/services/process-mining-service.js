// Global namespace for process mining service
window.processMiningService = {
    
    /**
     * Helper function to create a unique ID for an event
     * This distinguishes between Alarms and Changes with the same tag
     */
    _getUniqueEventId: function(event) {
        if (!event || !event.tag) return 'UNKNOWN';
        if (event.isAlarm) return `[A] ${event.tag}`;
        if (event.isChange) return `[C] ${event.tag}`;
        // Fallback for events that are neither
        return `[E] ${event.tag}`; 
    },

    /**
     * Helper to parse the unique ID back into its components
     */
    _parseUniqueEventId: function(uniqueId) {
        const match = uniqueId.match(/^\[(A|C|E)\] (.*)$/);
        if (match) {
            return {
                type: match[1] === 'A' ? 'Alarm' : (match[1] === 'C' ? 'Change' : 'Event'),
                tag: match[2],
                isAlarm: match[1] === 'A',
                isChange: match[1] === 'C'
            };
        }
        return { type: 'Unknown', tag: uniqueId, isAlarm: false, isChange: false };
    },

    /**
     * Builds a heuristic net for process visualization.
     * @param {Array} sessions The sessions to build the graph from.
     * @param {Object} filters Heuristic mining parameters
     * @returns {object} An object with nodes and edges for vis.js.
     */
    buildProcessGraph: function(sessions, filters = {}) {
        // Default parameters for heuristic mining
        const params = {
            dependencyThreshold: filters.dependencyThreshold || 0.5,
            frequencyThreshold: filters.frequencyThreshold || 0.02,
            showLoops: filters.showLoops !== false,
            showParallel: filters.showParallel !== false,
            ...filters
        };

        // Calculate dependency matrix and discover process model
        const dependencyMatrix = this.calculateDependencyMatrix(sessions);
        const causalRelations = this.findCausalRelations(dependencyMatrix, params.dependencyThreshold);
        const parallelRelations = this.detectParallelActivities(dependencyMatrix, params.dependencyThreshold);
        const loops = params.showLoops ? this.detectLoops(dependencyMatrix, causalRelations) : [];
        
        // Build heuristic net - pass dependencyMatrix as parameter
        return this.constructHeuristicNet(
            dependencyMatrix.activities,
            causalRelations,
            parallelRelations,
            loops,
            dependencyMatrix.startActivities,
            dependencyMatrix.endActivities,
            params,
            dependencyMatrix // Pass the full matrix for weak dependency detection
        );
    },

    /**
     * Calculates the dependency matrix for all activity pairs.
     * @param {Array} sessions The sessions to analyze
     * @returns {Object} Dependency matrix and activity information
     */
    calculateDependencyMatrix: function(sessions) {
        const directSuccession = new Map(); // A>B occurrences
        const activities = new Map(); // Activity frequencies
        const startActivities = new Map();
        const endActivities = new Map();
        
        // Count direct successions and activity frequencies
        sessions.forEach(session => {
            if (session.events.length === 0) return;
            
            // Track start and end activities using the unique ID
            const startActivity = this._getUniqueEventId(session.events[0]);
            startActivities.set(startActivity, (startActivities.get(startActivity) || 0) + 1);
            const endActivity = this._getUniqueEventId(session.events[session.events.length - 1]);
            endActivities.set(endActivity, (endActivities.get(endActivity) || 0) + 1);
            
            session.events.forEach((event, idx) => {
                const activity = this._getUniqueEventId(event);
                
                // Store activity info. This key is now unique (e.g., "[A] HS-101")
                // This fixes the "last-one-wins" bug
                activities.set(activity, {
                    count: (activities.get(activity)?.count || 0) + 1,
                    isAlarm: event.isAlarm,
                    isChange: event.isChange,
                    priority: event.priority
                });
                
                if (idx < session.events.length - 1) {
                    const nextActivity = this._getUniqueEventId(session.events[idx + 1]);
                    // The key is now unique (e.g., "[A] HS-101 > [C] HS-101")
                    const key = `${activity}>${nextActivity}`;
                    directSuccession.set(key, (directSuccession.get(key) || 0) + 1);
                }
            });
        });
        
        // Calculate dependency values
        const dependencies = new Map();
        const totalSessions = sessions.length;
        
        activities.forEach((_, actA) => {
            activities.forEach((_, actB) => {
                if (actA !== actB) {
                    const aToB = directSuccession.get(`${actA}>${actB}`) || 0;
                    const bToA = directSuccession.get(`${actB}>${actA}`) || 0;
                    
                    // Dependency measure: (|A>B| - |B>A|) / (|A>B| + |B>A| + 1)
                    const dependency = (aToB - bToA) / (aToB + bToA + 1);
                    
                    // Frequency relative to total sessions
                    const frequency = aToB / totalSessions;
                    
                    if (aToB > 0) {
                        dependencies.set(`${actA}>${actB}`, {
                            from: actA,
                            to: actB,
                            dependency: dependency,
                            frequency: frequency,
                            absoluteFrequency: aToB
                        });
                    }
                }
            });
        });
        
        return {
            activities,
            dependencies,
            directSuccession,
            startActivities,
            endActivities,
            totalSessions
        };
    },

    /**
     * Finds causal relations based on dependency threshold.
     * @param {Object} matrix Dependency matrix
     * @param {number} threshold Minimum dependency value
     * @returns {Array} Causal relations
     */
    findCausalRelations: function(matrix, threshold) {
        const causalRelations = [];
        
        matrix.dependencies.forEach((dep, key) => {
            if (dep.dependency >= threshold) {
                causalRelations.push({
                    from: dep.from,
                    to: dep.to,
                    dependency: dep.dependency,
                    frequency: dep.frequency,
                    absoluteFrequency: dep.absoluteFrequency,
                    type: 'causal'
                });
            }
        });
        
        // Don't remove transitive edges - keep all connections to avoid isolated nodes
        return causalRelations;
    },

    /**
     * Detects parallel activities (AND-splits/joins).
     * @param {Object} matrix Dependency matrix
     * @param {number} threshold Threshold for parallel detection
     * @returns {Array} Parallel relations
     */
    detectParallelActivities: function(matrix, threshold) {
        const parallelRelations = [];
        const parallelGroups = new Map(); // Group activities that are parallel
        
        matrix.dependencies.forEach((dep) => {
            const reverse = matrix.dependencies.get(`${dep.to}>${dep.from}`);
            if (reverse) {
                // Both A>B and B>A exist with similar frequency
                const avgDependency = (Math.abs(dep.dependency) + Math.abs(reverse.dependency)) / 2;
                // More strict criteria for parallel detection
                if (avgDependency < 0.2 && dep.frequency > 0.05 && reverse.frequency > 0.05) {
                    // Group parallel activities together
                    let foundGroup = false;
                    parallelGroups.forEach((group, key) => {
                        if (group.has(dep.from) || group.has(dep.to)) {
                            group.add(dep.from);
                            group.add(dep.to);
                            foundGroup = true;
                        }
                    });
                    
                    if (!foundGroup) {
                        const newGroup = new Set([dep.from, dep.to]);
                        parallelGroups.set(`group_${parallelGroups.size}`, newGroup);
                    }
                }
            }
        });
        
        // Convert groups to parallel relations
        parallelGroups.forEach((group) => {
            if (group.size > 1) {
                parallelRelations.push({
                    activities: Array.from(group),
                    frequency: 0.1, // Calculate actual frequency if needed
                    type: 'parallel'
                });
            }
        });
        
        return parallelRelations;
    },

    /**
     * Detects loops in the process.
     * @param {Object} matrix Dependency matrix
     * @param {Array} causalRelations Causal relations
     * @returns {Array} Detected loops
     */
    detectLoops: function(matrix, causalRelations) {
        const loops = [];
        const visited = new Set();
        
        // Build adjacency list from causal relations
        const adjacency = new Map();
        causalRelations.forEach(rel => {
            if (!adjacency.has(rel.from)) adjacency.set(rel.from, []);
            adjacency.get(rel.from).push(rel.to);
        });
        
        // DFS to find loops
        const findLoopsFromNode = (start, current, path) => {
            if (path.includes(current)) {
                // Found a loop
                const loopStart = path.indexOf(current);
                const loopPath = path.slice(loopStart).concat(current);
                const loopKey = loopPath.slice().sort().join('>>');
                
                if (!visited.has(loopKey) && loopPath.length > 2) {
                    visited.add(loopKey);
                    
                    // Calculate loop frequency
                    let minFreq = Infinity;
                    for (let i = 0; i < loopPath.length - 1; i++) {
                        const edge = `${loopPath[i]}>${loopPath[i + 1]}`;
                        const freq = matrix.directSuccession.get(edge) || 0;
                        minFreq = Math.min(minFreq, freq);
                    }
                    
                    loops.push({
                        activities: loopPath.slice(0, -1),
                        frequency: minFreq / matrix.totalSessions,
                        type: 'loop'
                    });
                }
                return;
            }
            
            const neighbors = adjacency.get(current) || [];
            neighbors.forEach(next => {
                findLoopsFromNode(start, next, [...path, current]);
            });
        };
        
        // Start DFS from each node
        adjacency.forEach((_, node) => {
            findLoopsFromNode(node, node, []);
        });
        
        return loops.filter(loop => loop.frequency > 0.01); // Filter out rare loops
    },

    /**
     * Constructs the heuristic net for visualization.
     * SIMPLIFIED VERSION - ensures no isolated nodes
     */
    constructHeuristicNet: function(activities, causalRelations, parallelRelations, loops, startActivities, endActivities, params, dependencyMatrix) {
        const nodes = new Map();
        const edges = [];
        let nodeId = 0;
        
        // Build adjacency maps to track connections
        const hasIncoming = new Map();
        const hasOutgoing = new Map();
        
        causalRelations.forEach(rel => {
            if (!hasOutgoing.has(rel.from)) hasOutgoing.set(rel.from, new Set());
            if (!hasIncoming.has(rel.to)) hasIncoming.set(rel.to, new Set());
            hasOutgoing.get(rel.from).add(rel.to);
            hasIncoming.get(rel.to).add(rel.from);
        });
        
        // Identify activities that should be shown
        const visibleActivities = new Set();
        
        // Add all activities that meet frequency threshold
        activities.forEach((info, activity) => {
            const relativeFreq = info.count / activities.size;
            if (relativeFreq >= params.frequencyThreshold) {
                visibleActivities.add(activity);
            }
        });
        
        // Add all activities that are connected by visible causal relations
        causalRelations.forEach(rel => {
            if (rel.frequency >= params.frequencyThreshold || rel.dependency >= params.dependencyThreshold) {
                visibleActivities.add(rel.from);
                visibleActivities.add(rel.to);
            }
        });
        
        // Find true start and end activities among visible activities
        const trueStarts = [];
        const trueEnds = [];
        
        // First pass: find activities with no incoming/outgoing edges in the causal relations
        visibleActivities.forEach(activity => {
            const hasIncomingEdges = hasIncoming.has(activity) && hasIncoming.get(activity).size > 0;
            const hasOutgoingEdges = hasOutgoing.has(activity) && hasOutgoing.get(activity).size > 0;
            
            // True start: no incoming edges from any activity
            if (!hasIncomingEdges && startActivities.has(activity)) {
                trueStarts.push(activity);
            }
            
            // True end: no outgoing edges to any activity
            if (!hasOutgoingEdges && endActivities.has(activity)) {
                trueEnds.push(activity);
            }
        });
        
        // Second pass: if we found no ends, look for activities with no outgoing edges at all
        if (trueEnds.length === 0) {
            visibleActivities.forEach(activity => {
                const hasOutgoingEdges = hasOutgoing.has(activity) && hasOutgoing.get(activity).size > 0;
                if (!hasOutgoingEdges) {
                    trueEnds.push(activity);
                }
            });
        }
        
        // If no clear starts/ends found, use the most frequent start/end activities
        if (trueStarts.length === 0) {
            const sortedStarts = Array.from(startActivities.entries())
                .filter(([act, _]) => visibleActivities.has(act))
                .sort((a, b) => b[1] - a[1]);
            if (sortedStarts.length > 0) {
                trueStarts.push(sortedStarts[0][0]);
            }
        }
        
        if (trueEnds.length === 0) {
            const sortedEnds = Array.from(endActivities.entries())
                .filter(([act, _]) => visibleActivities.has(act))
                .sort((a, b) => b[1] - a[1]);
            if (sortedEnds.length > 0) {
                trueEnds.push(sortedEnds[0][0]);
            }
        }
        
        // Create single START and END nodes if needed
        const needsStartNode = trueStarts.length > 1 || trueStarts.length === 0;
        const needsEndNode = trueEnds.length > 1 || trueEnds.length === 0;
        
        if (needsStartNode) {
            nodes.set('__START__', {
                id: '__START__',
                label: 'START',
                shape: 'circle',
                color: { background: '#90EE90', border: '#228B22' },
                font: { size: 14, face: 'Arial', color: '#228B22' },
                borderWidth: 3,
                size: 30,
                title: 'Process Start'
            });
        }
        
        if (needsEndNode) {
            nodes.set('__END__', {
                id: '__END__',
                label: 'END',
                shape: 'circle',
                color: { background: '#FFB6C1', border: '#DC143C' },
                font: { size: 14, face: 'Arial', color: '#DC143C' },
                borderWidth: 3,
                size: 30,
                title: 'Process End'
            });
        }
        
        // Create nodes for visible activities
        visibleActivities.forEach(activity => {
            // activity is now the unique ID, e.g., "[A] HS-101"
            const info = activities.get(activity);
            const parsedId = this._parseUniqueEventId(activity);
            
            const isStart = trueStarts.includes(activity);
            // FIXED: Only mark as end if it truly has no outgoing edges
            const hasOutgoingEdges = hasOutgoing.has(activity) && hasOutgoing.get(activity).size > 0;
            const isEnd = trueEnds.includes(activity) && !hasOutgoingEdges;
            
            // Determine colors based on both type and position
            let backgroundColor, borderColor;
            if (isStart) {
                // Start nodes: lighter green for alarms, darker green for actions
                backgroundColor = info.isAlarm ? '#CCFFCC' : '#90EE90';
                borderColor = info.isAlarm ? '#66CC66' : '#228B22';
            } else if (isEnd) {
                // End nodes: lighter pink for alarms, darker pink for actions
                backgroundColor = info.isAlarm ? '#FFCCDD' : '#FFB6C1';
                borderColor = info.isAlarm ? '#FF6699' : '#DC143C';
            } else {
                // Regular nodes: orange for alarms, blue for actions
                backgroundColor = info.isAlarm ? '#FFE4B5' : '#87CEEB';
                borderColor = info.isAlarm ? '#FF8C00' : '#4682B4';
            }
            
            nodes.set(activity, {
                id: activity, // Use the unique ID
                label: `${parsedId.tag}\n(${info.count})\n${info.isAlarm ? '⚠️ Alarm' : '✓ Action'}`,
                shape: isStart || isEnd ? 'ellipse' : 'box',
                color: {
                    background: backgroundColor,
                    border: borderColor
                },
                font: { size: 14, face: 'Arial' },
                borderWidth: isStart || isEnd ? 3 : 2,
                value: Math.log(info.count + 1) * 10,
                title: `${parsedId.tag}\nType: ${parsedId.type}\nOccurrences: ${info.count}\nPriority: ${info.priority || 'N/A'}\n${isStart ? 'START EVENT' : isEnd ? 'END EVENT' : ''}`
            });
        });
        
        // Connect START node to start activities
        if (needsStartNode) {
            if (trueStarts.length === 0) {
                // Find the first activities in visible set
                visibleActivities.forEach(activity => {
                    const incoming = hasIncoming.get(activity);
                    if (!incoming || incoming.size === 0 || 
                        Array.from(incoming).every(a => !visibleActivities.has(a))) {
                        edges.push({
                            from: '__START__',
                            to: activity,
                            arrows: { to: { enabled: true } },
                            width: 2,
                            color: { color: '#228B22' },
                            smooth: { type: 'dynamic' } // Use dynamic for better layout
                        });
                    }
                });
            } else {
                trueStarts.forEach(activity => {
                    edges.push({
                        from: '__START__',
                        to: activity,
                        arrows: { to: { enabled: true } },
                        width: 2,
                        color: { color: '#228B22' },
                        smooth: { type: 'dynamic' }
                    });
                });
            }
        }
        
        // Connect end activities to END node
        if (needsEndNode) {
            if (trueEnds.length === 0) {
                // Find the last activities in visible set
                visibleActivities.forEach(activity => {
                    const outgoing = hasOutgoing.get(activity);
                    if (!outgoing || outgoing.size === 0 || 
                        Array.from(outgoing).every(a => !visibleActivities.has(a))) {
                        edges.push({
                            from: activity,
                            to: '__END__',
                            arrows: { to: { enabled: true } },
                            width: 2,
                            color: { color: '#DC143C' },
                            smooth: { type: 'dynamic' }
                        });
                    }
                });
            } else {
                trueEnds.forEach(activity => {
                    edges.push({
                        from: activity,
                        to: '__END__',
                        arrows: { to: { enabled: true } },
                        width: 2,
                        color: { color: '#DC143C' },
                        smooth: { type: 'dynamic' }
                    });
                });
            }
        }
        
        // Add edges for causal relations between visible nodes
        causalRelations.forEach(rel => {
            if (nodes.has(rel.from) && nodes.has(rel.to)) {
                edges.push({
                    id: `${rel.from}-${rel.to}`,
                    from: rel.from,
                    to: rel.to,
                    label: rel.absoluteFrequency.toString(),
                    arrows: { to: { enabled: true, scaleFactor: 1 } },
                    width: Math.min(Math.max(1, Math.log(rel.absoluteFrequency + 1)), 5),
                    color: { 
                        color: rel.dependency > 0.8 ? '#2563eb' : 
                               rel.dependency > 0.6 ? '#3b82f6' : '#93c5fd' 
                    },
                    smooth: { type: 'dynamic' },
                    font: { size: 12, align: 'horizontal', background: 'white' },
                    title: `Dependency: ${rel.dependency.toFixed(2)}\nFrequency: ${(rel.frequency * 100).toFixed(1)}%\nOccurrences: ${rel.absoluteFrequency}`
                });
            }
        });
        
        // Check for isolated nodes and connect them
        const connectedNodes = new Set();
        edges.forEach(edge => {
            connectedNodes.add(edge.from);
            connectedNodes.add(edge.to);
        });
        
        nodes.forEach((node, nodeId) => {
            if (!connectedNodes.has(nodeId)) {
                // This node is isolated - connect it based on temporal information
                const activity = nodeId;
                
                // If it typically appears at the start, connect from START
                if (startActivities.has(activity) && nodes.has('__START__')) {
                    edges.push({
                        from: '__START__',
                        to: activity,
                        arrows: { to: { enabled: true } },
                        width: 1,
                        color: { color: '#cccccc' },
                        dashes: [5, 5],
                        title: 'Inferred connection'
                    });
                }
                // If it typically appears at the end, connect to END
                else if (endActivities.has(activity) && nodes.has('__END__')) {
                    edges.push({
                        from: activity,
                        to: '__END__',
                        arrows: { to: { enabled: true } },
                        width: 1,
                        color: { color: '#cccccc' },
                        dashes: [5, 5],
                        title: 'Inferred connection'
                    });
                }
                // Otherwise, try to find the best connection based on weak dependencies
                else {
                    // Find the strongest weak dependency
                    let bestConnection = null;
                    let bestDependency = 0;
                    
                    activities.forEach((_, otherActivity) => {
                        if (otherActivity !== activity && nodes.has(otherActivity)) {
                            const dep = dependencyMatrix.dependencies.get(`${activity}>${otherActivity}`);
                            if (dep && dep.dependency > bestDependency) {
                                bestConnection = { from: activity, to: otherActivity, dep };
                                bestDependency = dep.dependency;
                            }
                            
                            const depReverse = dependencyMatrix.dependencies.get(`${otherActivity}>${activity}`);
                            if (depReverse && depReverse.dependency > bestDependency) {
                                bestConnection = { from: otherActivity, to: activity, dep: depReverse };
                                bestDependency = depReverse.dependency;
                            }
                        }
                    });
                    
                    if (bestConnection) {
                        edges.push({
                            from: bestConnection.from,
                            to: bestConnection.to,
                            arrows: { to: { enabled: true } },
                            width: 1,
                            color: { color: '#cccccc' },
                            dashes: [5, 5],
                            label: bestConnection.dep.absoluteFrequency.toString(),
                            title: `Weak dependency: ${bestConnection.dep.dependency.toFixed(2)}`
                        });
                    }
                }
            }
        });
        
        // Add loop edges if enabled
        if (params.showLoops) {
            loops.forEach(loop => {
                loop.activities.forEach((activity, idx) => {
                    const next = loop.activities[(idx + 1) % loop.activities.length];
                    if (nodes.has(activity) && nodes.has(next)) {
                        const existingEdge = edges.find(e => e.from === activity && e.to === next);
                        if (existingEdge) {
                            existingEdge.color = { color: '#FF6347' };
                            existingEdge.title += '\n(Part of loop)';
                        } else {
                            edges.push({
                                from: activity,
                                to: next,
                                arrows: { to: { enabled: true } },
                                dashes: [10, 10],
                                color: { color: '#FF6347' },
                                width: 2,
                                title: `Loop edge\nLoop frequency: ${(loop.frequency * 100).toFixed(1)}%`
                            });
                        }
                    }
                });
            });
        }
        
        return {
            nodes: Array.from(nodes.values()),
            edges: edges
        };
    },

    /**
     * Creates a Directly-Follows Graph (DFG) with heuristic insights.
     * @param {Array} sessions The sessions to build the DFG from.
     * @returns {object} The DFG data object and associated stats.
     */
    createDFG: function(sessions) {
        const matrix = this.calculateDependencyMatrix(sessions);
        const causalRelations = this.findCausalRelations(matrix, 0.5);
        const parallelRelations = this.detectParallelActivities(matrix, 0.5);
        const loops = this.detectLoops(matrix, causalRelations);
        
        // Convert to DFG format
        const dfg = {
            activities: Array.from(matrix.activities.entries()).map(([uniqueId, info]) => ({ 
                name: uniqueId, // The unique ID, e.g., "[A] HS-101"
                parsed: this._parseUniqueEventId(uniqueId),
                count: info.count,
                isAlarm: info.isAlarm
            })),
            edges: causalRelations.map(rel => ({
                source: rel.from,
                target: rel.to,
                count: rel.absoluteFrequency,
                dependency: rel.dependency
            })),
            startActivities: Array.from(matrix.startActivities.entries()).map(([name, count]) => ({ name, count })),
            endActivities: Array.from(matrix.endActivities.entries()).map(([name, count]) => ({ name, count })),
            parallelActivities: parallelRelations,
            loops: loops
        };

        // Create visual representation for DFG
        const dfgVisual = this.createDFGVisualization(dfg);

        const stats = {
            totalActivities: matrix.activities.size,
            totalEdges: causalRelations.length,
            parallelGateways: parallelRelations.length,
            loops: loops.length,
            mostFrequentActivity: Array.from(matrix.activities.entries())
                .sort((a, b) => b[1].count - a[1].count)[0],
            strongestDependency: causalRelations
                .sort((a, b) => b.dependency - a.dependency)[0],
            avgActivitiesPerCase: sessions.reduce((sum, s) => sum + s.events.length, 0) / sessions.length
        };

        return { dfg, dfgVisual, stats };
    },

    /**
     * Creates a visual representation of the DFG with heuristic insights.
     * @param {object} dfg The DFG data
     * @returns {string} HTML representation of the DFG
     */
    createDFGVisualization: function(dfg) {
        // Sort activities by frequency
        const sortedActivities = dfg.activities.sort((a, b) => b.count - a.count);
        const topActivities = sortedActivities.slice(0, 10);
        
        // Sort edges by dependency strength
        const sortedEdges = dfg.edges.sort((a, b) => b.dependency - a.dependency);
        const topEdges = sortedEdges.slice(0, 15);
        
        let html = '<div class="dfg-visualization">';
        
        // Key insights
        html += '<div class="bg-blue-50 p-4 rounded-lg mb-6">';
        html += '<h4 className="font-semibold text-blue-900 mb-2"><i class="fas fa-lightbulb mr-2"></i>Key Insights</h4>';
        html += '<ul class="text-sm text-blue-800 space-y-1">';
        if (dfg.parallelActivities.length > 0) {
            html += `<li>• Found ${dfg.parallelActivities.length} parallel activity groups</li>`;
        }
        if (dfg.loops.length > 0) {
            html += `<li>• Detected ${dfg.loops.length} loop patterns</li>`;
        }
        html += `<li>• ${dfg.startActivities.length} different starting points</li>`;
        html += `<li>• ${dfg.endActivities.length} different ending points</li>`;
        html += '</ul>';
        html += '</div>';
        
        // Top activities
        html += '<h4 class="font-semibold mb-3">Top Activities</h4>';
        html += '<div class="space-y-2 mb-6">';
        
        topActivities.forEach(activity => {
            const percentage = ((activity.count / dfg.activities.reduce((sum, a) => sum + a.count, 0)) * 100).toFixed(1);
            const bgColor = activity.isAlarm ? 'bg-orange-200' : 'bg-blue-200';
            const icon = activity.isAlarm ? '⚠️' : '✓';
            html += `
                <div class="flex items-center justify-between bg-gray-50 p-2 rounded">
                    <span class="font-medium">${icon} ${activity.parsed.tag}</span>
                    <div class="flex items-center">
                        <div class="w-32 bg-gray-200 rounded-full h-2 mr-2">
                            <div class="${bgColor} h-2 rounded-full" style="width: ${percentage}%"></div>
                        </div>
                        <span class="text-sm text-gray-600">${activity.count}</span>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        
        // Strongest dependencies
        html += '<h4 class="font-semibold mb-3">Strongest Dependencies</h4>';
        html += '<div class="space-y-2 mb-6">';
        
        topEdges.forEach(edge => {
            const depStrength = (edge.dependency * 100).toFixed(0);
            const color = edge.dependency > 0.8 ? 'text-green-600' : 
                         edge.dependency > 0.6 ? 'text-blue-600' : 'text-gray-600';
            const sourceParsed = this._parseUniqueEventId(edge.source);
            const targetParsed = this._parseUniqueEventId(edge.target);
            
            html += `
                <div class="flex items-center justify-between bg-gray-50 p-2 rounded">
                    <span class="text-sm">
                        <span class="font-medium ${sourceParsed.isAlarm ? 'text-orange-700' : 'text-blue-700'}">${sourceParsed.tag}</span>
                        <i class="fas fa-arrow-right mx-2 text-gray-400"></i>
                        <span class="font-medium ${targetParsed.isAlarm ? 'text-orange-700' : 'text-blue-700'}">${targetParsed.tag}</span>
                    </span>
                    <div class="flex items-center gap-3">
                        <span class="text-xs ${color} font-semibold">${depStrength}%</span>
                        <span class="text-sm text-gray-600">${edge.count}×</span>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        
        // Parallel activities
        if (dfg.parallelActivities.length > 0) {
            html += '<h4 class="font-semibold mb-3">Parallel Activities</h4>';
            html += '<div class="space-y-2 mb-6">';
            
            dfg.parallelActivities.slice(0, 5).forEach(parallel => {
                const activityTags = parallel.activities.map(id => this._parseUniqueEventId(id).tag).join(' ↔ ');
                html += `
                    <div class="bg-purple-50 p-2 rounded">
                        <span class="text-sm text-purple-800">
                            <i class="fas fa-code-branch mr-2"></i>
                            ${activityTags}
                        </span>
                    </div>
                `;
            });
            
            html += '</div>';
        }
        
        // Loops
        if (dfg.loops.length > 0) {
            html += '<h4 class="font-semibold mb-3">Detected Loops</h4>';
            html += '<div class="space-y-2">';
            
            dfg.loops.slice(0, 5).forEach(loop => {
                const loopPercentage = (loop.frequency * 100).toFixed(1);
                const loopTags = loop.activities.map(id => this._parseUniqueEventId(id).tag);
                html += `
                    <div class="bg-red-50 p-2 rounded">
                        <span class="text-sm text-red-800">
                            <i class="fas fa-redo mr-2"></i>
                            ${loopTags.join(' → ')} → ${loopTags[0]}
                            <span class="text-xs ml-2">(${loopPercentage}% of cases)</span>
                        </span>
                    </div>
                `;
            });
            
            html += '</div>';
        }
        
        html += '</div>';
        
        return html;
    },

    /**
     * Discovers process variants using heuristic approach.
     * @param {Array} sessions The sessions to analyze for variants.
     * @returns {Array} A sorted array of discovered process variants.
     */
    discoverProcessVariants: function(sessions) {
        const variantMap = new Map();
        const matrix = this.calculateDependencyMatrix(sessions);
        const causalRelations = this.findCausalRelations(matrix, 0.5);
        
        // Build adjacency list for main process paths
        const mainProcess = new Map();
        causalRelations.forEach(rel => {
            if (!mainProcess.has(rel.from)) mainProcess.set(rel.from, new Set());
            mainProcess.get(rel.from).add(rel.to);
        });
        
        // Group sessions by their conformance to main process
        sessions.forEach(session => {
            const variantKey = this.getVariantSignature(session, mainProcess);
            
            if (!variantMap.has(variantKey)) {
                variantMap.set(variantKey, {
                    variant: variantKey,
                    // Store unique IDs in the events list
                    events: session.events.map(e => this._getUniqueEventId(e)),
                    count: 1,
                    sessionIds: [session.id],
                    avgDuration: session.duration,
                    avgAlarms: session.alarms,
                    avgActions: session.actions,
                    conformance: this.calculateConformance(session, mainProcess)
                });
            } else {
                const variant = variantMap.get(variantKey);
                variant.count++;
                variant.sessionIds.push(session.id);
                variant.avgDuration = (variant.avgDuration * (variant.count - 1) + session.duration) / variant.count;
                variant.avgAlarms = (variant.avgAlarms * (variant.count - 1) + session.alarms) / variant.count;
                variant.avgActions = (variant.avgActions * (variant.count - 1) + session.actions) / variant.count;
            }
        });

        return Array.from(variantMap.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 50);
    },

    /**
     * Gets variant signature considering main process paths.
     * @param {Object} session The session
     * @param {Map} mainProcess Main process adjacency list
     * @returns {string} Variant signature
     */
    getVariantSignature: function(session, mainProcess) {
        // Use the unique IDs for the signature
        const events = session.events.map(e => this._getUniqueEventId(e));
        const signature = [];
        
        for (let i = 0; i < events.length; i++) {
            const parsed = this._parseUniqueEventId(events[i]);
            // Display a shorter, more readable version in the signature
            const shortName = `${parsed.isAlarm ? '⚠️' : '✓'} ${parsed.tag}`;
            signature.push(shortName);
            
            // Mark deviations from main process
            if (i < events.length - 1) {
                const current = events[i]; // The unique ID
                const next = events[i + 1]; // The next unique ID
                const expectedNext = mainProcess.get(current);
                
                if (!expectedNext || !expectedNext.has(next)) {
                    signature.push('*'); // Mark deviation
                }
            }
        }
        
        return signature.join(' → ');
    },

    /**
     * Calculates conformance score for a session.
     * @param {Object} session The session
     * @param {Map} mainProcess Main process adjacency list
     * @returns {number} Conformance score (0-1)
     */
    calculateConformance: function(session, mainProcess) {
        if (session.events.length < 2) return 1;
        
        let conformingEdges = 0;
        let totalEdges = 0;
        
        for (let i = 0; i < session.events.length - 1; i++) {
            const current = this._getUniqueEventId(session.events[i]);
            const next = this._getUniqueEventId(session.events[i + 1]);
            const expectedNext = mainProcess.get(current);
            
            totalEdges++;
            if (expectedNext && expectedNext.has(next)) {
                conformingEdges++;
            }
        }
        
        return totalEdges > 0 ? conformingEdges / totalEdges : 1;
    }
};