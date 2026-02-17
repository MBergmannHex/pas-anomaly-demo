// OpenAI Configuration
// IMPORTANT: Keep this file secure and do not commit to version control
window.OPENAI_CONFIG = {
    // Azure OpenAI Settings
    apiKey: '8b6760edb24446b7bc16d2fe3a7a0b88',
    endpoint: 'https://hobbits-gpt-eastus2.openai.azure.com',
    deploymentName: 'gpt-4.1',
    apiVersion: '2025-03-01-preview'
};

// Immediately configure the chatbot service if it exists and config is not placeholder
if (window.chatbotService && window.OPENAI_CONFIG.apiKey !== 'YOUR_AZURE_OPENAI_API_KEY_HERE') {
    // Only apply defaults if user hasn't saved their own settings
    const existingApiKey = localStorage.getItem('chatbotApiKey');
    if (!existingApiKey || existingApiKey.trim() === '') {
        // Merge new config with existing config (preserves reasoningEffort if not in OPENAI_CONFIG)
        window.chatbotService.saveConfig(window.OPENAI_CONFIG);
        console.log('OpenAI configuration applied from config file');
    } else {
        console.log('OpenAI configuration skipped - user settings exist in localStorage');
    }
}