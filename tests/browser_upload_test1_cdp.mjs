import { spawn } from 'child_process';

const PORT = 9224;
const SITE_URL = 'http://127.0.0.1:8090/bulk-upload.html?plan=silver&price=44';
const TEST_FILE = '/home/ubuntu/upload/Test1.xlsx';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForJson(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

class CDPClient {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message}: ${message.error.data || ''}`));
        else resolve(message.result || {});
        return;
      }
      const callbacks = this.handlers.get(message.method) || [];
      callbacks.forEach(callback => callback(message.params || {}));
    });
  }
  on(method, callback) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(callback);
  }
  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { this.ws.close(); }
}

async function main() {
  const chrome = spawn('/usr/bin/chromium', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=/tmp/compliantuk-upload-validation-${Date.now()}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  chrome.stderr.on('data', chunk => { stderr += String(chunk); });

  try {
    const targets = await waitForJson(`http://127.0.0.1:${PORT}/json/list`);
    const page = targets.find(target => target.type === 'page');
    if (!page) throw new Error('No Chromium page target found');

    const cdp = new CDPClient(page.webSocketDebuggerUrl);
    const dialogs = [];
    cdp.on('Page.javascriptDialogOpening', async params => {
      dialogs.push(params.message);
      await cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });

    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: SITE_URL });
    await cdp.send('Page.loadEventFired').catch(() => {});
    await sleep(1200);

    await cdp.send('Runtime.evaluate', {
      expression: `
        window.__uploadAlerts = [];
        window.alert = (message) => { window.__uploadAlerts.push(String(message)); };
        document.getElementById('s1-first').value = 'Acceptance';
        document.getElementById('s1-last').value = 'Tester';
        document.getElementById('s1-email').value = 'acceptance.browser@example.com';
        document.getElementById('s1-org').value = 'CompliantUK Browser Validation';
        document.getElementById('s1-type').value = 'Private landlord';
        goStep2();
        true;
      `,
      awaitPromise: false,
    });

    const root = await cdp.send('DOM.getDocument', { depth: 1, pierce: true });
    const input = await cdp.send('DOM.querySelector', { nodeId: root.root.nodeId, selector: '#file-input' });
    if (!input.nodeId) throw new Error('File input #file-input not found');
    await cdp.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [TEST_FILE] });

    const deadline = Date.now() + 8000;
    let state;
    while (Date.now() < deadline) {
      const evaluation = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const get = id => document.getElementById(id);
          return {
            alerts: window.__uploadAlerts || [],
            parsedType: Array.isArray(parsedData) ? 'array' : typeof parsedData,
            properties: typeof parsedData !== 'undefined' && Array.isArray(parsedData) ? parsedData.length : null,
            processedTenants: typeof processingReport !== 'undefined' && processingReport ? processingReport.processedTenants : null,
            skippedCount: typeof processingReport !== 'undefined' && processingReport ? processingReport.skippedCount : null,
            filePreviewShown: get('file-preview').classList.contains('show'),
            reviewButtonVisible: get('step2-btn').style.display !== 'none',
            progressVisible: get('progress-overlay').classList.contains('show'),
            orderProps: get('os-props').textContent,
            orderTotal: get('os-total').textContent,
          };
        })()` ,
        returnByValue: true,
      });
      state = evaluation.result.value;
      if (!state.progressVisible && (state.properties !== null || state.alerts.length)) break;
      await sleep(250);
    }

    cdp.close();
    chrome.kill('SIGTERM');

    if (dialogs.length || state.alerts.length) {
      throw new Error(`Upload produced alert(s): ${JSON.stringify([...dialogs, ...state.alerts])}; state=${JSON.stringify(state)}`);
    }
    if (state.properties !== 2 || state.processedTenants !== 2 || state.skippedCount !== 0) {
      throw new Error(`Unexpected parsed state: ${JSON.stringify(state)}`);
    }
    if (!state.filePreviewShown || !state.reviewButtonVisible) {
      throw new Error(`Upload UI did not reach successful preview/review state: ${JSON.stringify(state)}`);
    }
    console.log(JSON.stringify({ ok: true, url: SITE_URL, file: TEST_FILE, state }, null, 2));
  } catch (error) {
    chrome.kill('SIGTERM');
    console.error(stderr.split('\n').slice(-20).join('\n'));
    throw error;
  }
}

main();
