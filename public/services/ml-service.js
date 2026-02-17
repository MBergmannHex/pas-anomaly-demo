// Global namespace for ML service  
window.mlService = {
    /**
     * Saves a trained model and its configuration (in-memory only since localStorage not supported).
     * @param {object} model The model object containing tfModel, tagToIndex, etc.
     */
    saveModelToStorage: async function(model) {
        // Store model in window object for session persistence
        window.savedAlarmModel = {
            model: model,
            savedAt: new Date().toISOString()
        };
        console.log('Model saved to session memory');
    },

    /**
     * Loads a model from session memory if it exists.
     * @returns {Promise<object|null>} The loaded model object or null.
     */
    loadSavedModel: async function() {
        if (window.savedAlarmModel) {
            console.log('Model loaded from session memory, saved at', window.savedAlarmModel.savedAt);
            return window.savedAlarmModel.model;
        }
        return null;
    },

    /**
     * Deletes the saved model from session memory.
     */
    deleteSavedModel: async function() {
        window.savedAlarmModel = null;
        console.log('Model deleted from session memory');
    },

    /**
     * Trains the sequence prediction model.
     * @param {Array} validSessions The sessions to use for training.
     * @param {Array} allData All event data for frequency counting.
     * @param {number} trainingEpochs Number of epochs to train for.
     * @param {function} onEpochEnd Callback function for progress updates.
     * @returns {Promise<object>} The trained model object.
     */
    trainModel: async function(validSessions, allData, trainingEpochs, onEpochEnd) {
        const sequences = [];
        const targets = [];
        const tagToIndex = {};
        const indexToTag = {};
        let tagIndex = 0;

        const tagFrequency = _.countBy(allData, 'tag');
        const MAX_VOCAB_SIZE = 100;
        const sortedTags = Object.entries(tagFrequency)
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_VOCAB_SIZE)
            .map(([tag]) => tag);

        sortedTags.forEach(tag => {
            tagToIndex[tag] = tagIndex;
            indexToTag[tagIndex] = tag;
            tagIndex++;
        });
        tagToIndex['<RARE>'] = tagIndex;
        indexToTag[tagIndex] = '<RARE>';

        const SEQUENCE_LENGTH = 3;
        const trainingSessions = validSessions.slice(0, 500);

        trainingSessions.forEach(session => {
            for (let i = 0; i < session.events.length - SEQUENCE_LENGTH; i++) {
                const sequence = session.events.slice(i, i + SEQUENCE_LENGTH)
                    .map(e => tagToIndex[e.tag] ?? tagToIndex['<RARE>']);
                const targetTag = session.events[i + SEQUENCE_LENGTH].tag;
                const targetIndex = tagToIndex[targetTag] ?? tagToIndex['<RARE>'];
                sequences.push(sequence);
                targets.push(targetIndex);
            }
        });

        if (sequences.length === 0) {
            throw new Error('Not enough sequential data to train model.');
        }

        const vocabSize = Object.keys(tagToIndex).length;
        const model = tf.sequential({
            layers: [
                tf.layers.embedding({ inputDim: vocabSize, outputDim: 16, inputLength: SEQUENCE_LENGTH }),
                tf.layers.lstm({ units: 32, returnSequences: false, activation: 'tanh' }),
                tf.layers.dropout({ rate: 0.3 }),
                tf.layers.dense({ units: vocabSize, activation: 'softmax' })
            ]
        });
        model.compile({ optimizer: tf.train.adam(0.002), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

        const xTrain = tf.tensor2d(sequences, [sequences.length, SEQUENCE_LENGTH], 'int32');
        const yTrain = tf.oneHot(tf.tensor1d(targets, 'int32'), vocabSize);

        await model.fit(xTrain, yTrain, {
            epochs: trainingEpochs,
            batchSize: 128,
            validationSplit: 0.2,
            shuffle: true,
            callbacks: { onEpochEnd }
        });
        
        const trainedModel = { tfModel: model, tagToIndex, indexToTag, sequenceLength: SEQUENCE_LENGTH };
        await this.saveModelToStorage(trainedModel);
        
        xTrain.dispose();
        yTrain.dispose();

        return trainedModel;
    },

    /**
     * Predicts the next events based on an input sequence.
     * @param {object} model The trained model object.
     * @param {string} queryInput The comma-separated input string.
     * @returns {object|null} An object with prediction results or null.
     */
    predictNextEvents: function(model, queryInput) {
        if (!model || !queryInput) return null;
        
        const inputTags = queryInput.split(',').map(tag => tag.trim());
        if (inputTags.length === 0) return null;
        
        let mlPrediction = null;
        
        // Prepare sequence for prediction
        const sequenceForPrediction = inputTags.slice(-model.sequenceLength);
        while (sequenceForPrediction.length < model.sequenceLength) {
            sequenceForPrediction.unshift('<RARE>'); // Pad with a rare token
        }
        
        try {
            const sequence = sequenceForPrediction.map(tag => model.tagToIndex[tag] || model.tagToIndex['<RARE>']);
            const input = tf.tensor2d([sequence], [1, model.sequenceLength], 'int32');
            const prediction = model.tfModel.predict(input);
            const probs = prediction.dataSync();

            const topIndices = Array.from(probs)
                .map((prob, idx) => ({ prob, idx }))
                .sort((a, b) => b.prob - a.prob)
                .slice(0, 5)
                .filter(item => item.prob > 0.01);

            mlPrediction = topIndices.map(item => ({
                tag: model.indexToTag[item.idx] || 'Unknown',
                probability: item.prob
            }));

            input.dispose();
            prediction.dispose();
        } catch (error) {
            console.error('Prediction error:', error);
            mlPrediction = [];
        }
        
        const sequenceHint = inputTags.length < model.sequenceLength
            ? `For better ML predictions, enter ${model.sequenceLength} events (you entered ${inputTags.length})`
            : null;

        return { mlPrediction, sequenceHint };
    },

    /**
     * Finds the most common operator actions following a given tag.
     * @param {string} lastTag The last tag in the input sequence.
     * @param {Array} validSessions A list of valid sessions to search within.
     * @returns {Array} A list of common responses.
     */
    findCommonResponses: function(lastTag, validSessions) {
        const patterns = {};
        const recentSessions = validSessions.slice(0, 200);

        recentSessions.forEach(session => {
            for (let i = 0; i < session.events.length - 1; i++) {
                if (session.events[i].tag === lastTag && session.events[i + 1].isChange) {
                    const nextEvent = session.events[i + 1];
                    patterns[nextEvent.tag] = (patterns[nextEvent.tag] || 0) + 1;
                }
            }
        });

        return Object.entries(patterns)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([tag, count]) => ({ tag, count }));
    },

    /**
     * Finds the best historical operator responses to an alarm.
     * @param {string} initialAlarmTag The alarm tag to find responses for.
     * @param {Array} validSessions A list of valid sessions to search within.
     * @returns {Array} A scored and sorted list of optimal responses.
     */
    findBestOperatorResponses: function(initialAlarmTag, validSessions) {
        const responses = {};
        const sessionsToAnalyze = validSessions.slice(0, 300);

        sessionsToAnalyze.forEach(session => {
            const alarmIndex = session.events.findIndex(e => e.tag === initialAlarmTag && e.isAlarm);
            if (alarmIndex !== -1) {
                let operatorActions = [];
                let firstActionTime = 0;
                
                for (let i = alarmIndex + 1; i < session.events.length; i++) {
                    const event = session.events[i];
                    if (event.isChange) {
                        operatorActions.push(event.tag);
                        if (!firstActionTime) firstActionTime = event.timestamp;
                    }
                    // Stop after the first sequence of actions
                    if (event.isAlarm && operatorActions.length > 0) break; 
                }

                if (operatorActions.length > 0) {
                    const responseKey = operatorActions.join(' → ');
                    if (!responses[responseKey]) {
                        responses[responseKey] = { actions: operatorActions, scores: [], resolutionTimes: [], occurrences: 0 };
                    }
                    const res = responses[responseKey];
                    res.occurrences++;
                    
                    const resolutionTime = session.endTime - firstActionTime;
                    res.resolutionTimes.push(resolutionTime);
                    
                    // Simple scoring: shorter resolution time is better (up to a cap)
                    const score = Math.max(0, 1 - (resolutionTime / (15 * 60 * 1000)));
                    res.scores.push(score);
                }
            }
        });

        return Object.values(responses)
            .map(res => ({
                actions: res.actions,
                avgScore: _.mean(res.scores),
                avgResolutionTime: _.mean(res.resolutionTimes),
                occurrences: res.occurrences,
            }))
            .filter(res => res.occurrences > 1)
            .sort((a, b) => b.avgScore - a.avgScore)
            .slice(0, 5);
    }
};