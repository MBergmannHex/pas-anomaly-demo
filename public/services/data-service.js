// Global namespace for data service
window.dataService = {
    // Default column mappings for common formats
    defaultColumnMappings: {
        timestamp: ['TimestampUtc', 'Timestamp', 'DateTime', 'Time', 'Date'],
        tag: ['Tag', 'TagName', 'AlarmTag', 'Name', 'Point'],
        journal: ['Journal', 'Type', 'EventType', 'Category', 'Event'],
        priority: ['Priority', 'Severity', 'Level', 'EventPriority'],
        unit: ['Unit', 'Area', 'Plant', 'Location', 'PlantUnit'],
        // New optional fields for uniqueness
        alarmState: ['Alarm', 'AlarmState', 'State', 'Condition', 'SubCondition', 'Alarm_Type'],
        actionParameter: ['Parameter', 'Value', 'NewValue', 'Action_Param', 'Target'],

        description: ['Description', 'Message', 'Text', 'Comment'],
        descriptiveColumns: ['Desc1', 'Desc2', 'DescOne', 'DescTwo', 'TagDescription', 'Module_Description', 'ModuleDesc', 'AlarmDescription', 'EventDescription', 'Message', 'Text', 'Comment', 'State_Source_Comment']
    },

    // Cache for date format detection
    dateFormatCache: null,

    /**
     * Parses a CSV file using PapaParse with optimized settings.
     * @param {File} file The CSV file to parse.
     * @returns {Promise<Object>} Parsed data with headers and rows.
     */
    parseCsvFile: function (file) {
        return new Promise((resolve, reject) => {
            const results = {
                data: [],
                headers: [],
                errors: []
            };

            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: false, // Keep as strings for consistent processing
                fastMode: true, // Enable fast mode for better performance
                chunk: function (chunk, parser) {
                    // Process chunks for large files
                    results.data = results.data.concat(chunk.data);
                    if (results.headers.length === 0 && chunk.meta.fields) {
                        results.headers = chunk.meta.fields;
                    }

                    // For very large files, stop after a reasonable amount
                    if (results.data.length > 1000000) {
                        parser.abort();
                        results.errors.push({
                            type: 'FileTooLarge',
                            message: 'File too large. Processing first 1 million rows only.'
                        });
                    }
                },
                complete: function () {
                    // Filter out completely empty rows
                    const cleanData = results.data.filter(row => {
                        return Object.values(row).some(value => value && value.toString().trim() !== '');
                    });

                    resolve({
                        data: cleanData,
                        headers: results.headers,
                        errors: results.errors
                    });
                },
                error: function (error) {
                    reject(error);
                }
            });
        });
    },

    /**
     * Analyzes CSV headers for column mapping with minimal samples.
     * @param {Array} headers The CSV headers.
     * @param {Array} sampleData Sample rows (only 3-5 needed).
     * @returns {Object} Suggested mappings and analysis.
     */
    analyzeColumns: function (headers, sampleData) {
        const mappings = {
            timestamp: null,
            tag: null,
            journal: null,
            priority: null,
            unit: null,
            alarmState: null, // New
            actionParameter: null, // New
            descriptiveColumns: []
        };

        const columnAnalysis = {};

        // Limit sample analysis to first 3 rows for speed
        const samplesToAnalyze = sampleData.slice(0, 3);

        // Quick pass to detect columns by name
        headers.forEach(header => {
            if (!header || header.trim() === '') return;

            const headerLower = header.toLowerCase();
            const analysis = {
                name: header,
                samples: [],
                dataType: 'unknown',
                nullCount: 0,
                suggestedMapping: null
            };

            // Get sample values (max 3)
            for (let i = 0; i < Math.min(3, samplesToAnalyze.length); i++) {
                const value = samplesToAnalyze[i][header];
                if (value !== null && value !== undefined && value !== '') {
                    analysis.samples.push(String(value).substring(0, 50));
                } else {
                    analysis.nullCount++;
                }
            }

            // Quick data type detection from first sample
            if (analysis.samples.length > 0) {
                const firstSample = analysis.samples[0];
                if (firstSample.match(/\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/) ||
                    !isNaN(Date.parse(firstSample))) {
                    analysis.dataType = 'datetime';
                } else if (!isNaN(firstSample) && firstSample !== '') {
                    analysis.dataType = 'number';
                } else {
                    analysis.dataType = 'string';
                }
            }

            // Map columns based on header names

            // 1. Timestamp
            if (!mappings.timestamp && this.defaultColumnMappings.timestamp.some(t => headerLower === t.toLowerCase() || headerLower.includes(t.toLowerCase()))) {
                mappings.timestamp = header;
                analysis.suggestedMapping = 'timestamp';
            }

            // 2. Tag
            else if (!mappings.tag && this.defaultColumnMappings.tag.some(t => headerLower === t.toLowerCase())) {
                mappings.tag = header;
                analysis.suggestedMapping = 'tag';
            }

            // 3. Journal/Type
            else if (!mappings.journal && this.defaultColumnMappings.journal.some(t => headerLower === t.toLowerCase())) {
                mappings.journal = header;
                analysis.suggestedMapping = 'journal';
            }

            // 4. Priority
            else if (!mappings.priority && this.defaultColumnMappings.priority.some(t => headerLower === t.toLowerCase())) {
                mappings.priority = header;
                analysis.suggestedMapping = 'priority';
            }

            // 5. Unit
            else if (!mappings.unit && this.defaultColumnMappings.unit.some(t => headerLower === t.toLowerCase())) {
                mappings.unit = header;
                analysis.suggestedMapping = 'unit';
            }

            // 6. Alarm State (New)
            else if (!mappings.alarmState && this.defaultColumnMappings.alarmState.some(t => headerLower === t.toLowerCase())) {
                mappings.alarmState = header;
                analysis.suggestedMapping = 'alarmState';
            }

            // 7. Action Parameter (New)
            else if (!mappings.actionParameter && this.defaultColumnMappings.actionParameter.some(t => headerLower === t.toLowerCase())) {
                mappings.actionParameter = header;
                analysis.suggestedMapping = 'actionParameter';
            }

            // 8. Descriptive columns (Fallback)
            else if (this.defaultColumnMappings.descriptiveColumns.some(t => headerLower.includes(t.toLowerCase())) ||
                headerLower.includes('desc') ||
                headerLower.includes('message') ||
                headerLower.includes('comment')) {
                mappings.descriptiveColumns.push(header);
                analysis.suggestedMapping = 'descriptive';
            }

            columnAnalysis[header] = analysis;
        });

        const validation = {
            isValid: !!(mappings.timestamp && mappings.tag && mappings.journal),
            missingRequired: [],
            warnings: []
        };

        if (!mappings.timestamp) validation.missingRequired.push('timestamp');
        if (!mappings.tag) validation.missingRequired.push('tag');
        if (!mappings.journal) validation.missingRequired.push('journal/type');
        if (!mappings.priority) validation.warnings.push('No priority column found - all alarms will be set to low priority');
        if (!mappings.unit) validation.warnings.push('No unit column found - all events will be assigned to "Unknown" unit');
        if (!mappings.alarmState) validation.warnings.push('No Alarm State column found - alarms will be grouped by Tag only');

        return {
            mappings,
            columnAnalysis,
            validation,
            headers: headers.filter(h => h && h.trim() !== '')
        };
    },

    /**
     * Optimized data processing with column mappings.
     * Creates composite tags if alarmState or actionParameter are mapped.
     */
    processDataWithMappings: async function (rawData, mappings, onProgress) {
        const cleanData = [];
        const totalRows = rawData.length;
        let processedRows = 0;
        let skippedRows = 0;

        // Reset date format cache
        this.dateFormatCache = null;

        console.log('Using flexible mapping path');

        // Process in batches for better UI responsiveness
        const batchSize = 2000;

        for (let batchStart = 0; batchStart < rawData.length; batchStart += batchSize) {
            const batchEnd = Math.min(batchStart + batchSize, rawData.length);

            for (let i = batchStart; i < batchEnd; i++) {
                const row = rawData[i];

                // Skip rows without timestamp
                if (!row[mappings.timestamp]) {
                    skippedRows++;
                    continue;
                }

                // Parse timestamp with format detection
                let timestamp;
                if (!this.dateFormatCache) {
                    timestamp = this.parseTimestampWithDetection(row[mappings.timestamp]);
                } else if (this.dateFormatCache === 'auto') {
                    timestamp = moment(row[mappings.timestamp]).valueOf();
                } else {
                    timestamp = moment(row[mappings.timestamp], this.dateFormatCache).valueOf();
                }

                // Skip invalid timestamps
                if (isNaN(timestamp)) {
                    skippedRows++;
                    continue;
                }

                // Determine event type
                let isAlarm = false;
                let isChange = false;
                const journalValue = row[mappings.journal];
                if (journalValue) {
                    const journalLower = journalValue.toLowerCase();
                    isAlarm = journalLower.includes('alarm') || journalLower.includes('alm');
                    isChange = journalLower.includes('change') || journalLower.includes('action') || journalLower.includes('event');
                }

                const baseTag = row[mappings.tag] || 'UNKNOWN';
                let uniqueTag = baseTag;

                // --- REFINEMENT LOGIC: Create Unique Tag ---
                // If it is an Alarm and we have an Alarm State column (e.g. HI_ALM)
                if (isAlarm && mappings.alarmState && row[mappings.alarmState]) {
                    const state = row[mappings.alarmState].trim();
                    if (state) {
                        uniqueTag = `${baseTag} ${state}`;
                    }
                }
                // If it is a Change/Action and we have a Parameter column
                else if (isChange && mappings.actionParameter && row[mappings.actionParameter]) {
                    const param = row[mappings.actionParameter].trim();
                    if (param) {
                        uniqueTag = `${baseTag} ${param}`;
                    }
                }

                // Create processed row
                const processedRow = {
                    ...row, // Keep all original data
                    timestamp: timestamp,
                    tag: uniqueTag,     // The unique identifier for analysis (e.g., "LC5003 HI_ALM")
                    baseTag: baseTag,   // The original tag for grouping (e.g., "LC5003")
                    unit: row[mappings.unit] || 'Unknown',
                    priority: 'low',
                    isAlarm: isAlarm,
                    isChange: isChange
                };

                // Extract priority if mapped
                if (mappings.priority && row[mappings.priority]) {
                    processedRow.priority = window.statsService.extractPriority(row[mappings.priority]);
                }

                cleanData.push(processedRow);
                processedRows++;
            }

            // Progress update
            if (onProgress) {
                const progress = Math.round((batchEnd / totalRows) * 100);
                onProgress(progress, `Processed ${processedRows.toLocaleString()} rows, skipped ${skippedRows}...`);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        console.log(`Processing complete: ${processedRows} rows processed, ${skippedRows} skipped`);

        // Sort by timestamp
        const needsSort = this.checkIfNeedsSort(cleanData);
        if (needsSort) {
            console.log('Sorting data by timestamp...');
            if (onProgress) onProgress(95, 'Sorting data...');
            cleanData.sort((a, b) => a.timestamp - b.timestamp);
        }

        if (onProgress) onProgress(100, 'Processing complete!');

        return cleanData;
    },

    /**
     * Parse timestamp with automatic format detection.
     */
    parseTimestampWithDetection: function (dateStr) {
        const formats = [
            'M/D/YYYY H:mm', 'M/D/YYYY H:mm:ss',
            'MM/DD/YYYY HH:mm', 'MM/DD/YYYY HH:mm:ss',
            'DD/MM/YYYY HH:mm:ss', 'YYYY-MM-DD HH:mm:ss',
            'DD-MM-YYYY HH:mm:ss', 'MM-DD-YYYY HH:mm:ss',
            'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DD HH:mm:ss.SSS'
        ];

        for (const format of formats) {
            const parsed = moment(dateStr, format, true);
            if (parsed.isValid()) {
                this.dateFormatCache = format;
                console.log(`Detected date format: ${format}`);
                return parsed.valueOf();
            }
        }

        const fallback = moment(dateStr);
        if (fallback.isValid()) {
            this.dateFormatCache = 'auto';
            return fallback.valueOf();
        }

        return NaN;
    },

    /**
     * Check if data needs sorting.
     */
    checkIfNeedsSort: function (data) {
        if (data.length < 2) return false;
        const samplesToCheck = Math.min(10, Math.floor(data.length / 2));
        for (let i = 1; i < samplesToCheck; i++) {
            if (data[i].timestamp < data[i - 1].timestamp) return true;
        }
        const startIdx = data.length - samplesToCheck;
        for (let i = startIdx + 1; i < data.length; i++) {
            if (data[i].timestamp < data[i - 1].timestamp) return true;
        }
        return false;
    },

    /**
     * Creates an optimized column mapping UI component.
     */
    createColumnMappingUI: function (analysisResult) {
        const { mappings, columnAnalysis, validation, headers } = analysisResult;
        const html = [];

        const validHeaders = headers.filter(header =>
            header && header.trim() !== '' && !header.startsWith('_') && columnAnalysis[header]
        );

        html.push('<div class="column-mapping-ui">');

        // Validation status
        if (!validation.isValid || validation.warnings.length > 0) {
            html.push('<div class="mapping-validation mb-4">');

            if (!validation.isValid) {
                html.push(`
                    <div class="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                        <h4 class="text-red-800 font-semibold mb-2"><i class="fas fa-exclamation-triangle mr-2"></i>Missing Required Columns</h4>
                        <p class="text-red-700">Please map: ${validation.missingRequired.join(', ')}</p>
                    </div>
                `);
            }

            if (validation.warnings.length > 0) {
                html.push(`
                    <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                        <h4 class="text-yellow-800 font-semibold mb-2"><i class="fas fa-info-circle mr-2"></i>Recommendations</h4>
                        <ul class="text-yellow-700 text-sm">
                            ${validation.warnings.map(w => `<li>• ${w}</li>`).join('')}
                        </ul>
                    </div>
                `);
            }
            html.push('</div>');
        }

        // Required mappings grid
        html.push(`
            <div class="mb-6">
                <h3 class="text-lg font-semibold mb-3">Core Column Mappings</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        `);

        html.push(this._createMappingSelect('timestamp', 'Timestamp', 'Date/time when the event occurred', validHeaders, mappings.timestamp, columnAnalysis, true));
        html.push(this._createMappingSelect('tag', 'Tag Name', 'Base identifier (e.g., LC5003)', validHeaders, mappings.tag, columnAnalysis, true));
        html.push(this._createMappingSelect('journal', 'Event Type', 'Differentiates Alarms vs. Actions', validHeaders, mappings.journal, columnAnalysis, true));
        html.push(this._createMappingSelect('priority', 'Priority', 'Alarm priority level', validHeaders, mappings.priority, columnAnalysis, false));
        html.push(this._createMappingSelect('unit', 'Unit/Area', 'Plant unit location', validHeaders, mappings.unit, columnAnalysis, false));

        html.push('</div></div>');

        // OPTIONAL REFINEMENT MAPPINGS
        html.push(`
            <div class="mb-6 bg-blue-50 p-4 rounded-lg border border-blue-100">
                <h3 class="text-lg font-semibold mb-2 text-blue-900"><i class="fas fa-sliders-h mr-2"></i>Refinement Options (Recommended)</h3>
                <p class="text-sm text-blue-700 mb-3">Map these columns to distinguish between specific alarm states (e.g., HI vs LO) or action parameters.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        `);

        html.push(this._createMappingSelect('alarmState', 'Alarm State/Condition', 'e.g., HI_ALM, LO_ALM, TRIP (Appends to Tag)', validHeaders, mappings.alarmState, columnAnalysis, false));
        html.push(this._createMappingSelect('actionParameter', 'Action Parameter/Value', 'e.g., 50%, Auto, Manual (Appends to Tag)', validHeaders, mappings.actionParameter, columnAnalysis, false));

        html.push('</div></div>');

        // Descriptive columns
        const MAX_DESCRIPTIVE_SHOWN = 20;
        const descriptiveHeaders = validHeaders.slice(0, MAX_DESCRIPTIVE_SHOWN);

        if (descriptiveHeaders.length > 0) {
            html.push(`
                <div class="mb-6">
                    <h3 class="text-lg font-semibold mb-3">Description Columns</h3>
                    <p class="text-sm text-gray-600 mb-3">Select columns containing text messages for the AI assistant:</p>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 border rounded p-2 bg-gray-50">
            `);

            descriptiveHeaders.forEach(header => {
                const isChecked = mappings.descriptiveColumns.includes(header);
                const analysis = columnAnalysis[header];
                const sample = analysis.samples[0] || 'No data';

                html.push(`
                    <label class="flex items-start space-x-2 p-2 rounded hover:bg-gray-200 cursor-pointer">
                        <input type="checkbox" 
                               class="mt-1 descriptive-column-checkbox" 
                               data-column="${this._escapeHtml(header)}"
                               ${isChecked ? 'checked' : ''}>
                        <div class="flex-1 min-w-0">
                            <span class="font-medium text-sm block truncate">${this._escapeHtml(header)}</span>
                            <span class="text-xs text-gray-500 truncate" title="${this._escapeHtml(sample)}">
                                ${this._escapeHtml(sample.substring(0, 40))}...
                            </span>
                        </div>
                    </label>
                `);
            });
            html.push('</div></div>');
        }

        html.push('</div>');
        return html.join('');
    },

    _createMappingSelect: function (mappingType, label, description, headers, currentValue, columnAnalysis, required) {
        const html = [];
        html.push('<div class="mapping-field">');
        html.push(`
            <label class="block text-sm font-medium text-gray-700 mb-1">
                ${label} ${required ? '<span class="text-red-500">*</span>' : ''}
            </label>
            <p class="text-xs text-gray-500 mb-1">${description}</p>
            <select class="w-full px-3 py-2 border rounded-md column-mapping-select" data-mapping="${mappingType}">
                <option value="">-- Select Column --</option>
        `);

        headers.forEach(header => {
            const analysis = columnAnalysis[header];
            const isSelected = header === currentValue;
            const isSuggested = analysis.suggestedMapping === mappingType;
            const hint = analysis.dataType !== 'unknown' ? ` (${analysis.dataType})` : '';

            html.push(`
                <option value="${header}" ${isSelected ? 'selected' : ''} ${isSuggested ? 'class="font-semibold bg-green-50"' : ''}>
                    ${header}${hint}${isSuggested ? ' ⭐' : ''}
                </option>
            `);
        });

        html.push('</select>');

        if (currentValue && columnAnalysis[currentValue] && columnAnalysis[currentValue].samples.length > 0) {
            const sample = columnAnalysis[currentValue].samples[0];
            html.push(`
                <div class="text-xs text-gray-500 mt-1 truncate">
                    Sample: ${this._escapeHtml(sample.substring(0, 50))}
                </div>
            `);
        }

        html.push('</div>');
        return html.join('');
    },

    _escapeHtml: function (str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    getCurrentMappings: function () {
        const mappings = {
            timestamp: null,
            tag: null,
            journal: null,
            priority: null,
            unit: null,
            alarmState: null,
            actionParameter: null,
            descriptiveColumns: []
        };

        document.querySelectorAll('.column-mapping-select').forEach(select => {
            const mappingType = select.dataset.mapping;
            const value = select.value;
            if (value) mappings[mappingType] = value;
        });

        document.querySelectorAll('.descriptive-column-checkbox:checked').forEach(checkbox => {
            mappings.descriptiveColumns.push(checkbox.dataset.column);
        });

        return mappings;
    },

    validateMappings: function (mappings) {
        const validation = {
            isValid: true,
            errors: []
        };

        if (!mappings.timestamp) {
            validation.isValid = false;
            validation.errors.push('Timestamp column is required');
        }
        if (!mappings.tag) {
            validation.isValid = false;
            validation.errors.push('Tag column is required');
        }
        if (!mappings.journal) {
            validation.isValid = false;
            validation.errors.push('Journal/Event Type column is required');
        }

        return validation;
    },

    // --- D&R AUTO-PILOT FILE UTILS ---

    readFileAsText: function (file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    },

    generateMADbCSV: function (rationalizedData) {
        // 1. Generate Main MADb CSV (Flat fields)
        const mainData = rationalizedData.map(r => ({
            Tag: r.tag,
            Descriptor: r.descriptor,
            Description: r.description,
            Unit: r.unit,
            Type: r.type,
            ImportedPriority: r.priorities.imported,
            ApprovedPriority: r.priorities.approved,
            ResponseTime: r.response_time,
            Consequence: r.consequence_text,
            SafetyImpact: r.impacts.personnel_safety,
            EnvImpact: r.impacts.environmental,
            CostImpact: r.impacts.cost,
            Recommendation: r.Recommendation,
            PriorityReason: r.PriorityReason
        }));

        const csvMain = Papa.unparse(mainData);
        this._downloadCSV(csvMain, "MADb_Main.csv");

        // 2. Generate Causes CSV (Relational)
        const causesData = [];
        rationalizedData.forEach(r => {
            r.cause_consequence_map.forEach((c, idx) => {
                causesData.push({
                    Tag: r.tag,
                    CauseID: idx + 1,
                    Cause: c.cause,
                    Verification: c.verification,
                    CorrectiveAction: c.corrective_action
                });
            });
        });

        const csvCauses = Papa.unparse(causesData);
        this._downloadCSV(csvCauses, "MADb_Causes.csv");
    },

    _downloadCSV: function (csvContent, fileName) {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    generateARP_PDF: function (rationalizedData) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        rationalizedData.forEach((alarm, index) => {
            if (index > 0) doc.addPage();

            // --- HEADER GRID (High-Fidelity) ---
            doc.setFillColor(240, 240, 240);
            doc.rect(10, 10, 190, 25, 'F');

            doc.setFontSize(16);
            doc.setFont("helvetica", "bold");
            doc.text(`${alarm.tag}`, 15, 20);

            doc.setFontSize(12);
            doc.setTextColor(100, 100, 100);
            // Adjust X for Descriptor to avoid overlap with Tag
            const tagWidth = doc.getTextWidth(alarm.tag);
            doc.text(`${alarm.descriptor}`, 15 + tagWidth + 5, 20);

            doc.setFontSize(10);
            doc.setTextColor(150, 150, 150);
            // Wrap Description to fit available width
            const descX = 15;
            const descY = 24; // Moved down slightly
            const maxDescWidth = 180;
            const splitDesc = doc.splitTextToSize(alarm.description, maxDescWidth);
            doc.text(splitDesc, descX, descY);

            // Sub-header stats - Moved down to accommodate description
            const statsY = 32;
            doc.setFontSize(9);
            doc.setTextColor(0, 0, 0);
            const headers = ["Unit", "Type", "Imported Pri", "Approved Pri", "Response Time"];
            const values = [alarm.unit, alarm.type, alarm.priorities.imported, alarm.priorities.approved, alarm.response_time];

            let x = 15;
            headers.forEach((h, i) => {
                doc.setFont("helvetica", "bold");
                doc.text(h, x, statsY);
                doc.setFont("helvetica", "normal");

                // Highlight Approved Priority
                if (h === "Approved Pri") {
                    doc.setFillColor(63, 81, 181);
                    doc.rect(x - 1, statsY + 2, 20, 5, 'F');
                    doc.setTextColor(255, 255, 255);
                }
                doc.text(String(values[i]), x, statsY + 6);
                doc.setTextColor(0, 0, 0);
                x += 35;
            });

            // --- CAUSE TABLE (Relational) ---
            doc.autoTable({
                startY: 45,
                head: [['Cause', 'Verification', 'Corrective Action']],
                body: alarm.cause_consequence_map.map(c => [c.cause, c.verification, c.corrective_action]),
                theme: 'grid',
                headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' },
                styles: { fontSize: 9, cellPadding: 3 }
            });

            let finalY = doc.lastAutoTable.finalY + 10;

            // --- CONSEQUENCE BOX ---
            doc.setDrawColor(200, 200, 200);
            doc.rect(10, finalY, 190, 15);
            doc.setFont("helvetica", "bold");
            doc.text("Consequence Summary", 12, finalY + 5);
            doc.setFont("helvetica", "normal");
            doc.text(alarm.consequence_text, 12, finalY + 11);

            finalY += 25;

            // --- IMPACT MATRIX (Bottom Right) ---
            doc.autoTable({
                startY: finalY,
                margin: { left: 110 }, // Position on right side
                head: [['Impact Category', 'Severity']],
                body: [
                    ['Personnel Safety', alarm.impacts.personnel_safety],
                    ['Environmental', alarm.impacts.environmental],
                    ['Financial Cost', alarm.impacts.cost]
                ],
                theme: 'grid',
                headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0] },
                styles: { fontSize: 9 }
            });

            // --- LOGIC TREE (Bottom Left) ---
            doc.setFont("helvetica", "bold");
            doc.text("Logic / Constraints", 15, finalY + 5);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.text("• Items that I constrain: None", 15, finalY + 12);
            doc.text("• Items that constrain me:", 15, finalY + 17);
            doc.setTextColor(100, 100, 100);
            doc.text("   % Default Logic (val=100 Eq='{V} > {C} + 50')", 18, finalY + 22);

            // Footer
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(`Generated by Autonomous D&R Engine - ${new Date().toLocaleDateString()}`, 10, 285);
        });

        doc.save("Alarm_Response_Manual_ARP.pdf");
    },

    generateComplianceReport_PDF: function (rationalizedData, stats) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Title
        doc.setFontSize(22);
        doc.text("ISA 18.2 Compliance Audit Report", 15, 20);

        doc.setFontSize(12);
        doc.text(`Date: ${new Date().toLocaleDateString()}`, 15, 30);

        // Executive Summary
        doc.setFontSize(16);
        doc.text("1. Executive Summary", 15, 50);
        doc.setFontSize(12);
        doc.text(`Processed ${stats.totalAlarms} unique alarm tags.`, 15, 60);
        doc.text(`${stats.rationalizedCount} alarms were successfully rationalized.`, 15, 70);
        doc.text(`${stats.priorityChanges} alarms required priority adjustment based on the Philosophy.`, 15, 80);

        // Bad Actors
        doc.setFontSize(16);
        doc.text("2. Top Bad Actors (Chattering)", 15, 100);

        const badActors = rationalizedData
            .filter(a => a.Recommendation === 'Modify')
            .slice(0, 10)
            .map(a => [a.TagName, a.PriorityReason]);

        doc.autoTable({
            startY: 110,
            head: [['Tag', 'Issue']],
            body: badActors,
        });

        doc.save("Compliance_Audit_Report.pdf");
    }
};