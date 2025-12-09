# ChatGPT Search Query Revealer

A private Chrome extension that reveals the exact search queries ChatGPT sends when it searches the web.

## Files You Need

1. `manifest.json` - Extension configuration
2. `content.js` - Main script that intercepts queries
3. `popup.html` - Extension popup interface
4. `popup.js` - Popup logic
5. Icon files: `icon16.png`, `icon48.png`, `icon128.png`

## Setup Instructions

### Step 1: Create a folder
Create a new folder on your computer called `chatgpt-query-revealer`

### Step 2: Save all files
Copy each file from Claude into that folder with the exact filenames shown above.

### Step 3: Create icons
You need 3 icon files. Easiest option:
1. Go to https://favicon.io/emoji-favicons/magnifying-glass-tilted-left/
2. Download and rename to: `icon16.png`, `icon48.png`, `icon128.png`

Or create simple 16x16, 48x48, and 128x128 pixel images.

### Step 4: Load in Chrome
1. Open Chrome, go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select your `chatgpt-query-revealer` folder

## How to Use

1. Go to chatgpt.com
2. Ask something that triggers web search (e.g., "What's the latest AI news?")
3. A panel appears in bottom-right showing exact queries
4. Click any query to copy it
5. Click extension icon to see history and export CSV

## Features

- Real-time query capture
- Draggable panel
- Click to copy
- Query history
- Export to CSV
- Minimize/close panel

## Troubleshooting

**Panel not appearing?**
- Refresh the page after installing
- Check extension is enabled at `chrome://extensions`

**No queries showing?**
- Not all prompts trigger search
- Try asking about current events or recent news
