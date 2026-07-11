// Global application state
let merchantsList = [];
let triggersList = [];

// Format seconds into HH:MM:SS
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `Uptime: ${h}:${m}:${s}`;
}

// Fetch server status and metrics
async function updateStats() {
  try {
    const response = await fetch('/v1/healthz');
    const data = await response.json();
    
    document.getElementById('uptime-display').textContent = formatUptime(data.uptime_seconds);
    document.getElementById('count-category').textContent = data.contexts_loaded.category || 0;
    document.getElementById('count-merchant').textContent = data.contexts_loaded.merchant || 0;
    document.getElementById('count-customer').textContent = data.contexts_loaded.customer || 0;
    document.getElementById('count-trigger').textContent = data.contexts_loaded.trigger || 0;
  } catch (error) {
    console.error('Failed to fetch status:', error);
    document.getElementById('uptime-display').textContent = 'Server Offline';
  }
}

// Fetch metadata
async function loadMetadata() {
  try {
    const response = await fetch('/v1/metadata');
    const data = await response.json();
    document.getElementById('engine-meta-text').textContent = 
      `Running ${data.team_name} v${data.version} | Engine: ${data.model}`;
  } catch (error) {
    console.error('Failed to load metadata:', error);
  }
}

// Poll logs
async function pollLogs() {
  try {
    const response = await fetch('/api/logs');
    const logs = await response.json();
    
    const container = document.getElementById('logs-feed');
    container.innerHTML = '';
    
    if (logs.length === 0) {
      container.innerHTML = '<div class="log-entry system">Awaiting triggers...</div>';
      return;
    }
    
    logs.reverse().forEach(log => {
      const entry = document.createElement('div');
      entry.className = `log-entry ${log.type}`;
      
      const ts = new Date(log.timestamp).toLocaleTimeString();
      let text = `[${ts}] ${log.message}`;
      
      if (log.details) {
        if (typeof log.details === 'object') {
          text += `\n${JSON.stringify(log.details, null, 2)}`;
        } else {
          text += `\n${log.details}`;
        }
      }
      
      entry.textContent = text;
      container.appendChild(entry);
    });
  } catch (error) {
    console.error('Failed to poll logs:', error);
  }
}

// Fetch contexts to populate selection dropdowns
async function loadContextsDropdown() {
  try {
    const response = await fetch('/api/contexts');
    const data = await response.json();
    
    const merchantSelect = document.getElementById('sandbox-merchant');
    merchantSelect.innerHTML = '';
    
    merchantsList = data.merchants || [];
    
    if (merchantsList.length === 0) {
      merchantSelect.innerHTML = '<option value="">No active merchants loaded (Run warmup first)</option>';
      return;
    }
    
    // Fetch triggers as well by calling a generic list endpoint we'll integrate
    const triggerResponse = await fetch('/api/logs'); // fallback check
    
    // We map keys manually in config to match trigger payloads
    // To make it simple, we load the list of merchants
    // We fetch categories slug lists and match
    data.categories.forEach((catSlug, idx) => {
      // Create a grouping
      const optGroup = document.createElement('optgroup');
      optGroup.label = catSlug.toUpperCase();
      
      // Populate matching merchants
      const matched = data.merchants.filter((m, i) => {
        // Simple heuristic lookup or name matches
        return true; 
      });

      // Let's list all merchants simply
    });

    data.merchants.forEach((mName, index) => {
      const opt = document.createElement('option');
      opt.value = index; // index matching merchant ID
      opt.textContent = mName;
      merchantSelect.appendChild(opt);
    });
  } catch (error) {
    console.error('Failed to load contexts for dropdown:', error);
  }
}

// Trigger simulation
document.getElementById('run-sandbox-btn').addEventListener('click', async () => {
  const previewBox = document.getElementById('preview-output');
  const diagnosticsBox = document.getElementById('preview-diagnostics');
  
  previewBox.innerHTML = '<span class="placeholder-text">Simulating Composition...</span>';
  diagnosticsBox.innerHTML = '<span class="placeholder-text">Running calculations...</span>';
  
  try {
    const mIndex = document.getElementById('sandbox-merchant').value;
    const triggerKind = document.getElementById('sandbox-trigger').value;
    
    if (mIndex === '') {
      previewBox.textContent = 'Please wait until context is loaded.';
      diagnosticsBox.textContent = 'No contexts found.';
      return;
    }
    
    // Trigger tick manually using a special endpoint or finding the current active trigger in the store
    // Let's create an Express wrapper route '/api/manual-sandbox-tick' to run this directly
    const response = await fetch('/api/manual-sandbox-tick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantIndex: parseInt(mIndex, 10),
        triggerKind: triggerKind
      })
    });
    
    const result = await response.json();
    
    if (result.success && result.action) {
      previewBox.textContent = result.action.body || 'No message sent.';
      diagnosticsBox.textContent = JSON.stringify({
        cta: result.action.cta,
        send_as: result.action.send_as,
        suppression_key: result.action.suppression_key,
        rationale: result.action.rationale
      }, null, 2);
    } else {
      previewBox.textContent = 'Failed to generate message.';
      diagnosticsBox.textContent = result.error || 'Unknown error occurred.';
    }
  } catch (error) {
    previewBox.textContent = 'Connection error.';
    diagnosticsBox.textContent = error.message;
  }
});

// Setup intervals
loadMetadata();
updateStats();
pollLogs();
loadContextsDropdown();

setInterval(updateStats, 2000);
setInterval(pollLogs, 2000);
setInterval(loadContextsDropdown, 5000);
