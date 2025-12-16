// Options page script for API key management
const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';

document.addEventListener('DOMContentLoaded', async () => {
    const apiKeyInput = document.getElementById('apiKey');
    const apiForm = document.getElementById('apiForm');
    const saveStatus = document.getElementById('saveStatus');
    const testBtn = document.getElementById('testBtn');
    const apiStatus = document.getElementById('apiStatus');
    const apiStatusDot = document.querySelector('.api-status-dot');
    const apiStatusText = document.querySelector('.api-status-text');

    // Load saved API key
    const result = await chrome.storage.sync.get(['geminiApiKey']);
    if (result.geminiApiKey) {
        apiKeyInput.value = result.geminiApiKey;
        updateApiStatus(true, 'API key loaded');
    }

    // Save API key
    apiForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const apiKey = apiKeyInput.value.trim();
        
        if (!apiKey) {
            showStatus('Please enter an API key', 'error');
            return;
        }

        try {
            await chrome.storage.sync.set({ geminiApiKey: apiKey });
            showStatus('API key saved successfully', 'success');
            updateApiStatus(true, 'API key saved');
        } catch (error) {
            showStatus('Failed to save API key', 'error');
            console.error('Save error:', error);
        }
    });

    // Test API connection
    testBtn.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        
        if (!apiKey) {
            showStatus('Please enter an API key first', 'error');
            return;
        }

        testBtn.disabled = true;
        testBtn.textContent = 'Testing...';
        
        try {
            const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: 'Say "Hello, World!" in exactly 3 words.'
                        }]
                    }]
                })
            });

            if (response.ok) {
                showStatus('API key is valid and working', 'success');
                updateApiStatus(true, 'Connection successful');
            } else {
                const error = await response.json();
                showStatus(`API test failed: ${error.error?.message || 'Unknown error'}`, 'error');
                updateApiStatus(false, 'Invalid API key');
            }
        } catch (error) {
            showStatus('Connection failed. Check your network.', 'error');
            updateApiStatus(false, 'Connection error');
            console.error('Test error:', error);
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = 'Test Connection';
        }
    });

    function showStatus(message, type) {
        saveStatus.textContent = message;
        saveStatus.className = `status ${type}`;
        saveStatus.style.display = 'block';
        
        setTimeout(() => {
            saveStatus.style.display = 'none';
        }, 5000);
    }

    function updateApiStatus(valid, text) {
        apiStatus.style.display = 'flex';
        apiStatusDot.className = `api-status-dot ${valid ? 'valid' : 'invalid'}`;
        apiStatusText.textContent = text;
    }
});