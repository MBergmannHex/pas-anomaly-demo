// OpenAI Configuration Template
// IMPORTANT: Copy this file to openai-config.js and fill in your actual values
// DO NOT commit openai-config.js with real credentials
window.OPENAI_CONFIG = {
    // Azure OpenAI Settings
    apiKey: 'YOUR_AZURE_OPENAI_API_KEY_HERE',
    endpoint: 'https://YOUR-RESOURCE.openai.azure.com',
    deploymentName: 'gpt-4.1',
    apiVersion: '2024-02-15-preview'
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
