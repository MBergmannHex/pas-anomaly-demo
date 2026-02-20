'use strict';
/**
 * Process Mining Algorithms - Server-Side Only
 * Heuristic Miner implementation for alarm event log analysis
 */

// ============================================
// EVENT ID HELPERS
// ============================================

function _getUniqueEventId(event) {
    if (!event || !event.tag) return 'UNKNOWN';
    if (event.isAlarm) return `[A] ${event.tag}`;
    if (event.isChange) return `[C] ${event.tag}`;
    return `[E] ${event.tag}`;
}

function _parseUniqueEventId(uniqueId) {
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
}

// ============================================
// DEPENDENCY MATRIX
// ============================================

/**
 * Calculates the dependency matrix for all activity pairs.
 * Dependency measure: (|A>B| - |B>A|) / (|A>B| + |B>A| + 1)
 */
function calculateDependencyMatrix(sessions) {
    const directSuccession = new Map();
    const activities = new Map();
    const startActivities = new Map();
    const endActivities = new Map();

    sessions.forEach(session => {
        if (session.events.length === 0) return;

        const startActivity = _getUniqueEventId(session.events[0]);
        startActivities.set(startActivity, (startActivities.get(startActivity) || 0) + 1);
        const endActivity = _getUniqueEventId(session.events[session.events.length - 1]);
        endActivities.set(endActivity, (endActivities.get(endActivity) || 0) + 1);

        session.events.forEach((event, idx) => {
            const activity = _getUniqueEventId(event);
            activities.set(activity, {
                count: (activities.get(activity)?.count || 0) + 1,
                isAlarm: event.isAlarm,
                isChange: event.isChange,
                priority: event.priority
            });

            if (idx < session.events.length - 1) {
                const nextActivity = _getUniqueEventId(session.events[idx + 1]);
                const key = `${activity}>${nextActivity}`;
                directSuccession.set(key, (directSuccession.get(key) || 0) + 1);
            }
        });
    });

    const dependencies = new Map();
    const totalSessions = sessions.length;

    activities.forEach((_, actA) => {
        activities.forEach((_, actB) => {
            if (actA !== actB) {
                const aToB = directSuccession.get(`${actA}>${actB}`) || 0;
                const bToA = directSuccession.get(`${actB}>${actA}`) || 0;
                const dependency = (aToB - bToA) / (aToB + bToA + 1);
                const frequency = aToB / totalSessions;

                if (aToB > 0) {
                    dependencies.set(`${actA}>${actB}`, {
                        from: actA, to: actB,
                        dependency, frequency,
                        absoluteFrequency: aToB
                    });
                }
            }
        });
    });

    return { activities, dependencies, directSuccession, startActivities, endActivities, totalSessions };
}

// ============================================
// CAUSAL RELATIONS
// ============================================

function findCausalRelations(matrix, threshold) {
    const causalRelations = [];
    matrix.dependencies.forEach((dep) => {
        if (dep.dependency >= threshold) {
            causalRelations.push({
                from: dep.from, to: dep.to,
                dependency: dep.dependency,
                frequency: dep.frequency,
                absoluteFrequency: dep.absoluteFrequency,
                type: 'causal'
            });
        }
    });
    return causalRelations;
}

// ============================================
// PARALLEL ACTIVITIES
// ============================================

function detectParallelActivities(matrix, threshold) {
    const parallelRelations = [];
    const parallelGroups = new Map();

    matrix.dependencies.forEach((dep) => {
        const reverse = matrix.dependencies.get(`${dep.to}>${dep.from}`);
        if (reverse) {
            const avgDependency = (Math.abs(dep.dependency) + Math.abs(reverse.dependency)) / 2;
            if (avgDependency < 0.2 && dep.frequency > 0.05 && reverse.frequency > 0.05) {
                let foundGroup = false;
                parallelGroups.forEach((group) => {
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

    parallelGroups.forEach((group) => {
        if (group.size > 1) {
            parallelRelations.push({ activities: Array.from(group), frequency: 0.1, type: 'parallel' });
        }
    });

    return parallelRelations;
}

// ============================================
// LOOP DETECTION
// ============================================

function detectLoops(matrix, causalRelations) {
    const loops = [];
    const visited = new Set();

    const adjacency = new Map();
    causalRelations.forEach(rel => {
        if (!adjacency.has(rel.from)) adjacency.set(rel.from, []);
        adjacency.get(rel.from).push(rel.to);
    });

    const findLoopsFromNode = (start, current, path) => {
        if (path.includes(current)) {
            const loopStart = path.indexOf(current);
            const loopPath = path.slice(loopStart).concat(current);
            const loopKey = loopPath.slice().sort().join('>>');

            if (!visited.has(loopKey) && loopPath.length > 2) {
                visited.add(loopKey);

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

    adjacency.forEach((_, node) => {
        findLoopsFromNode(node, node, []);
    });

    return loops.filter(loop => loop.frequency > 0.01);
}

// ============================================
// HEURISTIC NET CONSTRUCTION
// ============================================

function constructHeuristicNet(activities, causalRelations, parallelRelations, loops, startActivities, endActivities, params, dependencyMatrix) {
    const nodes = new Map();
    const edges = [];

    const hasIncoming = new Map();
    const hasOutgoing = new Map();

    causalRelations.forEach(rel => {
        if (!hasOutgoing.has(rel.from)) hasOutgoing.set(rel.from, new Set());
        if (!hasIncoming.has(rel.to)) hasIncoming.set(rel.to, new Set());
        hasOutgoing.get(rel.from).add(rel.to);
        hasIncoming.get(rel.to).add(rel.from);
    });

    const visibleActivities = new Set();

    activities.forEach((info, activity) => {
        const relativeFreq = info.count / activities.size;
        if (relativeFreq >= params.frequencyThreshold) {
            visibleActivities.add(activity);
        }
    });

    causalRelations.forEach(rel => {
        if (rel.frequency >= params.frequencyThreshold || rel.dependency >= params.dependencyThreshold) {
            visibleActivities.add(rel.from);
            visibleActivities.add(rel.to);
        }
    });

    const trueStarts = [];
    const trueEnds = [];

    visibleActivities.forEach(activity => {
        const hasIncomingEdges = hasIncoming.has(activity) && hasIncoming.get(activity).size > 0;
        const hasOutgoingEdges = hasOutgoing.has(activity) && hasOutgoing.get(activity).size > 0;

        if (!hasIncomingEdges && startActivities.has(activity)) trueStarts.push(activity);
        if (!hasOutgoingEdges && endActivities.has(activity)) trueEnds.push(activity);
    });

    if (trueEnds.length === 0) {
        visibleActivities.forEach(activity => {
            const hasOutgoingEdges = hasOutgoing.has(activity) && hasOutgoing.get(activity).size > 0;
            if (!hasOutgoingEdges) trueEnds.push(activity);
        });
    }

    if (trueStarts.length === 0) {
        const sortedStarts = Array.from(startActivities.entries())
            .filter(([act]) => visibleActivities.has(act))
            .sort((a, b) => b[1] - a[1]);
        if (sortedStarts.length > 0) trueStarts.push(sortedStarts[0][0]);
    }

    if (trueEnds.length === 0) {
        const sortedEnds = Array.from(endActivities.entries())
            .filter(([act]) => visibleActivities.has(act))
            .sort((a, b) => b[1] - a[1]);
        if (sortedEnds.length > 0) trueEnds.push(sortedEnds[0][0]);
    }

    const needsStartNode = trueStarts.length > 1 || trueStarts.length === 0;
    const needsEndNode = trueEnds.length > 1 || trueEnds.length === 0;

    if (needsStartNode) {
        nodes.set('__START__', {
            id: '__START__', label: 'START', shape: 'circle',
            color: { background: '#90EE90', border: '#228B22' },
            font: { size: 14, face: 'Arial', color: '#228B22' },
            borderWidth: 3, size: 30, title: 'Process Start'
        });
    }

    if (needsEndNode) {
        nodes.set('__END__', {
            id: '__END__', label: 'END', shape: 'circle',
            color: { background: '#FFB6C1', border: '#DC143C' },
            font: { size: 14, face: 'Arial', color: '#DC143C' },
            borderWidth: 3, size: 30, title: 'Process End'
        });
    }

    visibleActivities.forEach(activity => {
        const info = activities.get(activity);
        const parsedId = _parseUniqueEventId(activity);

        const isStart = trueStarts.includes(activity);
        const hasOutgoingEdges = hasOutgoing.has(activity) && hasOutgoing.get(activity).size > 0;
        const isEnd = trueEnds.includes(activity) && !hasOutgoingEdges;

        let backgroundColor, borderColor;
        if (isStart) {
            backgroundColor = info.isAlarm ? '#CCFFCC' : '#90EE90';
            borderColor = info.isAlarm ? '#66CC66' : '#228B22';
        } else if (isEnd) {
            backgroundColor = info.isAlarm ? '#FFCCDD' : '#FFB6C1';
            borderColor = info.isAlarm ? '#FF6699' : '#DC143C';
        } else {
            backgroundColor = info.isAlarm ? '#FFE4B5' : '#87CEEB';
            borderColor = info.isAlarm ? '#FF8C00' : '#4682B4';
        }

        nodes.set(activity, {
            id: activity,
            label: `${parsedId.tag}\n(${info.count})\n${info.isAlarm ? '⚠️ Alarm' : '✓ Action'}`,
            shape: isStart || isEnd ? 'ellipse' : 'box',
            color: { background: backgroundColor, border: borderColor },
            font: { size: 14, face: 'Arial' },
            borderWidth: isStart || isEnd ? 3 : 2,
            value: Math.log(info.count + 1) * 10,
            title: `${parsedId.tag}\nType: ${parsedId.type}\nOccurrences: ${info.count}\nPriority: ${info.priority || 'N/A'}\n${isStart ? 'START EVENT' : isEnd ? 'END EVENT' : ''}`
        });
    });

    // Connect START node
    if (needsStartNode) {
        if (trueStarts.length === 0) {
            visibleActivities.forEach(activity => {
                const incoming = hasIncoming.get(activity);
                if (!incoming || incoming.size === 0 ||
                    Array.from(incoming).every(a => !visibleActivities.has(a))) {
                    edges.push({ from: '__START__', to: activity, arrows: { to: { enabled: true } }, width: 2, color: { color: '#228B22' }, smooth: { type: 'dynamic' } });
                }
            });
        } else {
            trueStarts.forEach(activity => {
                edges.push({ from: '__START__', to: activity, arrows: { to: { enabled: true } }, width: 2, color: { color: '#228B22' }, smooth: { type: 'dynamic' } });
            });
        }
    }

    // Connect END node
    if (needsEndNode) {
        if (trueEnds.length === 0) {
            visibleActivities.forEach(activity => {
                const outgoing = hasOutgoing.get(activity);
                if (!outgoing || outgoing.size === 0 ||
                    Array.from(outgoing).every(a => !visibleActivities.has(a))) {
                    edges.push({ from: activity, to: '__END__', arrows: { to: { enabled: true } }, width: 2, color: { color: '#DC143C' }, smooth: { type: 'dynamic' } });
                }
            });
        } else {
            trueEnds.forEach(activity => {
                edges.push({ from: activity, to: '__END__', arrows: { to: { enabled: true } }, width: 2, color: { color: '#DC143C' }, smooth: { type: 'dynamic' } });
            });
        }
    }

    // Causal relation edges
    causalRelations.forEach(rel => {
        if (nodes.has(rel.from) && nodes.has(rel.to)) {
            edges.push({
                id: `${rel.from}-${rel.to}`,
                from: rel.from, to: rel.to,
                label: rel.absoluteFrequency.toString(),
                arrows: { to: { enabled: true, scaleFactor: 1 } },
                width: Math.min(Math.max(1, Math.log(rel.absoluteFrequency + 1)), 5),
                color: { color: rel.dependency > 0.8 ? '#2563eb' : rel.dependency > 0.6 ? '#3b82f6' : '#93c5fd' },
                smooth: { type: 'dynamic' },
                font: { size: 12, align: 'horizontal', background: 'white' },
                title: `Dependency: ${rel.dependency.toFixed(2)}\nFrequency: ${(rel.frequency * 100).toFixed(1)}%\nOccurrences: ${rel.absoluteFrequency}`
            });
        }
    });

    // Isolated node recovery
    const connectedNodes = new Set();
    edges.forEach(edge => { connectedNodes.add(edge.from); connectedNodes.add(edge.to); });

    nodes.forEach((node, nodeId) => {
        if (!connectedNodes.has(nodeId)) {
            const activity = nodeId;
            if (startActivities.has(activity) && nodes.has('__START__')) {
                edges.push({ from: '__START__', to: activity, arrows: { to: { enabled: true } }, width: 1, color: { color: '#cccccc' }, dashes: [5, 5], title: 'Inferred connection' });
            } else if (endActivities.has(activity) && nodes.has('__END__')) {
                edges.push({ from: activity, to: '__END__', arrows: { to: { enabled: true } }, width: 1, color: { color: '#cccccc' }, dashes: [5, 5], title: 'Inferred connection' });
            } else {
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
                        from: bestConnection.from, to: bestConnection.to,
                        arrows: { to: { enabled: true } }, width: 1, color: { color: '#cccccc' },
                        dashes: [5, 5], label: bestConnection.dep.absoluteFrequency.toString(),
                        title: `Weak dependency: ${bestConnection.dep.dependency.toFixed(2)}`
                    });
                }
            }
        }
    });

    // Loop edges
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
                            from: activity, to: next,
                            arrows: { to: { enabled: true } }, dashes: [10, 10],
                            color: { color: '#FF6347' }, width: 2,
                            title: `Loop edge\nLoop frequency: ${(loop.frequency * 100).toFixed(1)}%`
                        });
                    }
                }
            });
        });
    }

    return { nodes: Array.from(nodes.values()), edges };
}

// ============================================
// PROCESS GRAPH BUILDER
// ============================================

function buildProcessGraph(sessions, filters = {}) {
    const params = {
        dependencyThreshold: filters.dependencyThreshold || 0.5,
        frequencyThreshold: filters.frequencyThreshold || 0.02,
        showLoops: filters.showLoops !== false,
        showParallel: filters.showParallel !== false,
        ...filters
    };

    const dependencyMatrix = calculateDependencyMatrix(sessions);
    const causalRelations = findCausalRelations(dependencyMatrix, params.dependencyThreshold);
    const parallelRelations = detectParallelActivities(dependencyMatrix, params.dependencyThreshold);
    const loops = params.showLoops ? detectLoops(dependencyMatrix, causalRelations) : [];

    return constructHeuristicNet(
        dependencyMatrix.activities,
        causalRelations,
        parallelRelations,
        loops,
        dependencyMatrix.startActivities,
        dependencyMatrix.endActivities,
        params,
        dependencyMatrix
    );
}

// ============================================
// DFG VISUALIZATION (HTML generation)
// ============================================

function createDFGVisualization(dfg) {
    const sortedActivities = dfg.activities.sort((a, b) => b.count - a.count);
    const topActivities = sortedActivities.slice(0, 10);
    const sortedEdges = dfg.edges.sort((a, b) => b.dependency - a.dependency);
    const topEdges = sortedEdges.slice(0, 15);

    let html = '<div class="dfg-visualization">';

    html += '<div class="bg-blue-50 p-4 rounded-lg mb-6">';
    html += '<h4 class="font-semibold text-blue-900 mb-2"><i class="fas fa-lightbulb mr-2"></i>Key Insights</h4>';
    html += '<ul class="text-sm text-blue-800 space-y-1">';
    if (dfg.parallelActivities.length > 0) html += `<li>• Found ${dfg.parallelActivities.length} parallel activity groups</li>`;
    if (dfg.loops.length > 0) html += `<li>• Detected ${dfg.loops.length} loop patterns</li>`;
    html += `<li>• ${dfg.startActivities.length} different starting points</li>`;
    html += `<li>• ${dfg.endActivities.length} different ending points</li>`;
    html += '</ul></div>';

    html += '<h4 class="font-semibold mb-3">Top Activities</h4>';
    html += '<div class="space-y-2 mb-6">';
    topActivities.forEach(activity => {
        const percentage = ((activity.count / dfg.activities.reduce((sum, a) => sum + a.count, 0)) * 100).toFixed(1);
        const bgColor = activity.isAlarm ? 'bg-orange-200' : 'bg-blue-200';
        const icon = activity.isAlarm ? '⚠️' : '✓';
        html += `<div class="flex items-center justify-between bg-gray-50 p-2 rounded"><span class="font-medium">${icon} ${activity.parsed.tag}</span><div class="flex items-center"><div class="w-32 bg-gray-200 rounded-full h-2 mr-2"><div class="${bgColor} h-2 rounded-full" style="width: ${percentage}%"></div></div><span class="text-sm text-gray-600">${activity.count}</span></div></div>`;
    });
    html += '</div>';

    html += '<h4 class="font-semibold mb-3">Strongest Dependencies</h4>';
    html += '<div class="space-y-2 mb-6">';
    topEdges.forEach(edge => {
        const depStrength = (edge.dependency * 100).toFixed(0);
        const color = edge.dependency > 0.8 ? 'text-green-600' : edge.dependency > 0.6 ? 'text-blue-600' : 'text-gray-600';
        const sourceParsed = _parseUniqueEventId(edge.source);
        const targetParsed = _parseUniqueEventId(edge.target);
        html += `<div class="flex items-center justify-between bg-gray-50 p-2 rounded"><span class="text-sm"><span class="font-medium ${sourceParsed.isAlarm ? 'text-orange-700' : 'text-blue-700'}">${sourceParsed.tag}</span><i class="fas fa-arrow-right mx-2 text-gray-400"></i><span class="font-medium ${targetParsed.isAlarm ? 'text-orange-700' : 'text-blue-700'}">${targetParsed.tag}</span></span><div class="flex items-center gap-3"><span class="text-xs ${color} font-semibold">${depStrength}%</span><span class="text-sm text-gray-600">${edge.count}×</span></div></div>`;
    });
    html += '</div>';

    if (dfg.parallelActivities.length > 0) {
        html += '<h4 class="font-semibold mb-3">Parallel Activities</h4><div class="space-y-2 mb-6">';
        dfg.parallelActivities.slice(0, 5).forEach(parallel => {
            const activityTags = parallel.activities.map(id => _parseUniqueEventId(id).tag).join(' ↔ ');
            html += `<div class="bg-purple-50 p-2 rounded"><span class="text-sm text-purple-800"><i class="fas fa-code-branch mr-2"></i>${activityTags}</span></div>`;
        });
        html += '</div>';
    }

    if (dfg.loops.length > 0) {
        html += '<h4 class="font-semibold mb-3">Detected Loops</h4><div class="space-y-2">';
        dfg.loops.slice(0, 5).forEach(loop => {
            const loopPercentage = (loop.frequency * 100).toFixed(1);
            const loopTags = loop.activities.map(id => _parseUniqueEventId(id).tag);
            html += `<div class="bg-red-50 p-2 rounded"><span class="text-sm text-red-800"><i class="fas fa-redo mr-2"></i>${loopTags.join(' → ')} → ${loopTags[0]}<span class="text-xs ml-2">(${loopPercentage}% of cases)</span></span></div>`;
        });
        html += '</div>';
    }

    html += '</div>';
    return html;
}

// ============================================
// DFG CREATION
// ============================================

function createDFG(sessions) {
    const matrix = calculateDependencyMatrix(sessions);
    const causalRelations = findCausalRelations(matrix, 0.5);
    const parallelRelations = detectParallelActivities(matrix, 0.5);
    const loops = detectLoops(matrix, causalRelations);

    const dfg = {
        activities: Array.from(matrix.activities.entries()).map(([uniqueId, info]) => ({
            name: uniqueId,
            parsed: _parseUniqueEventId(uniqueId),
            count: info.count,
            isAlarm: info.isAlarm
        })),
        edges: causalRelations.map(rel => ({
            source: rel.from, target: rel.to,
            count: rel.absoluteFrequency, dependency: rel.dependency
        })),
        startActivities: Array.from(matrix.startActivities.entries()).map(([name, count]) => ({ name, count })),
        endActivities: Array.from(matrix.endActivities.entries()).map(([name, count]) => ({ name, count })),
        parallelActivities: parallelRelations,
        loops
    };

    const dfgVisual = createDFGVisualization(dfg);

    const stats = {
        totalActivities: matrix.activities.size,
        totalEdges: causalRelations.length,
        parallelGateways: parallelRelations.length,
        loops: loops.length,
        mostFrequentActivity: Array.from(matrix.activities.entries()).sort((a, b) => b[1].count - a[1].count)[0],
        strongestDependency: causalRelations.sort((a, b) => b.dependency - a.dependency)[0],
        avgActivitiesPerCase: sessions.reduce((sum, s) => sum + s.events.length, 0) / sessions.length
    };

    return { dfg, dfgVisual, stats };
}

// ============================================
// PROCESS VARIANTS
// ============================================

function calculateConformance(session, mainProcess) {
    if (session.events.length < 2) return 1;

    let conformingEdges = 0;
    let totalEdges = 0;

    for (let i = 0; i < session.events.length - 1; i++) {
        const current = _getUniqueEventId(session.events[i]);
        const next = _getUniqueEventId(session.events[i + 1]);
        const expectedNext = mainProcess.get(current);
        totalEdges++;
        if (expectedNext && expectedNext.has(next)) conformingEdges++;
    }

    return totalEdges > 0 ? conformingEdges / totalEdges : 1;
}

function getVariantSignature(session, mainProcess) {
    const events = session.events.map(e => _getUniqueEventId(e));
    const signature = [];

    for (let i = 0; i < events.length; i++) {
        const parsed = _parseUniqueEventId(events[i]);
        const shortName = `${parsed.isAlarm ? '⚠️' : '✓'} ${parsed.tag}`;
        signature.push(shortName);

        if (i < events.length - 1) {
            const current = events[i];
            const next = events[i + 1];
            const expectedNext = mainProcess.get(current);
            if (!expectedNext || !expectedNext.has(next)) signature.push('*');
        }
    }

    return signature.join(' → ');
}

function discoverProcessVariants(sessions) {
    const variantMap = new Map();
    const matrix = calculateDependencyMatrix(sessions);
    const causalRelations = findCausalRelations(matrix, 0.5);

    const mainProcess = new Map();
    causalRelations.forEach(rel => {
        if (!mainProcess.has(rel.from)) mainProcess.set(rel.from, new Set());
        mainProcess.get(rel.from).add(rel.to);
    });

    sessions.forEach(session => {
        const variantKey = getVariantSignature(session, mainProcess);

        if (!variantMap.has(variantKey)) {
            variantMap.set(variantKey, {
                variant: variantKey,
                events: session.events.map(e => _getUniqueEventId(e)),
                count: 1,
                sessionIds: [session.id],
                avgDuration: session.duration,
                avgAlarms: session.alarms,
                avgActions: session.actions,
                conformance: calculateConformance(session, mainProcess)
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
}

module.exports = {
    buildProcessGraph,
    createDFG,
    discoverProcessVariants,
    calculateDependencyMatrix,
    findCausalRelations,
    detectParallelActivities,
    detectLoops,
    constructHeuristicNet,
    calculateConformance
};
