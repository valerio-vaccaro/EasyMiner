#!/usr/bin/env node
// Real-board browser checks. No npm packages are required (Node 22+, Chrome).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeGallery} from './screenshot_gallery.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brands = {
  base: {name: 'EasyMiner', environment: 'esp32-headless', logo: null},
  blox: {name: 'BLOXMiner', environment: 'esp32-headless-blox', logo: 'assets/blox/BLOX_SPACE_01_reduced.png'},
  satoshispritz: {name: 'SatoshiSpritzMiner', environment: 'esp32-headless-satoshispritz', logo: 'assets/satoshispritz/SSLogo.png'},
  officinebitcoin: {name: 'OfficineBitcoinMiner', environment: 'esp32-headless-officinebitcoin', logo: 'assets/officine/OBorange.png'},
  sbamminer: {name: 'SBAMminer', environment: 'esp32-headless-sbamminer', logo: 'assets/sbamminer/sbamminer_logo.png'},
};
const options = {url: 'http://easyminer.local', output: 'docs/screenshot', port: '/dev/ttyUSB0', brand: 'sbamminer', restore: 'sbamminer', start: 'base', chrome: 'google-chrome', pio: 'venv/bin/pio', flashAll: false};
for (let i = 2; i < process.argv.length; i++) {
  const argument = process.argv[i];
  if (argument === '--flash-all') options.flashAll = true;
  else {
    const key = argument.replace(/^--/, '');
    if (!Object.hasOwn(options, key) || !process.argv[i + 1]) throw new Error(`Unknown or incomplete option: ${argument}`);
    options[key] = process.argv[++i];
  }
}
assert(brands[options.brand] && brands[options.restore] && brands[options.start], 'Unknown brand');
const baseUrl = options.url.replace(/\/$/, '');
const outputDir = path.resolve(projectDir, options.output);
// Machine-only reports and failure diagnostics do not belong in documentation.
const reportDir = path.join(projectDir, '.pio', 'web-checks');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitUntil(check, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await check()) return; }
    catch (error) { lastError = error; }
    await sleep(250);
  }
  throw new Error(`Timed out: ${description}`, {cause: lastError});
}

async function flash(brandId) {
  const directory = path.join(reportDir, brandId);
  await fs.mkdir(directory, {recursive: true});
  const log = await fs.open(path.join(directory, 'platformio.log'), 'a');
  console.log(`[${brandId}] Building and uploading ${brands[brandId].environment}`);
  try {
    await new Promise((resolve, reject) => {
      const process = spawn(path.resolve(projectDir, options.pio), ['run', '-e', brands[brandId].environment, '-t', 'upload', '--upload-port', options.port], {
        cwd: projectDir, stdio: ['ignore', log.fd, log.fd],
      });
      process.on('error', reject);
      process.on('exit', code => code === 0 ? resolve() : reject(new Error(`PlatformIO exited ${code}; see ${directory}/platformio.log`)));
    });
  } finally { await log.close(); }
  await waitUntil(async () => {
    const response = await fetch(`${baseUrl}/`, {signal: AbortSignal.timeout(3000)});
    return response.ok && (await response.text()).includes(`data-brand="${brandId}"`);
  }, `${brandId} firmware to reconnect`, 90000);
}

class Chrome {
  nextId = 0;
  pending = new Map();
  exceptions = [];
  failedResponses = [];
  failedLoads = [];
  requests = new Map();
  socketFrames = 0;
  socketHandshakes = 0;
  transportRetries = [];

  async start() {
    this.profile = await fs.mkdtemp(path.join(os.tmpdir(), 'easyminer-chrome-'));
    this.process = spawn(options.chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--no-proxy-server', '--remote-debugging-port=0', `--user-data-dir=${this.profile}`, 'about:blank'], {stdio: 'ignore'});
    this.process.on('error', error => { this.startError = error; });
    let port;
    await waitUntil(async () => {
      if (this.startError) throw this.startError;
      port = (await fs.readFile(path.join(this.profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      return Boolean(port);
    }, 'headless Chrome startup');
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
    this.connection = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      this.connection.addEventListener('open', resolve, {once: true});
      this.connection.addEventListener('error', reject, {once: true});
    });
    this.connection.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') this.exceptions.push(message.params.exceptionDetails.text);
      if (message.method === 'Network.requestWillBeSent') this.requests.set(message.params.requestId, message.params.request.url);
      if (message.method === 'Network.loadingFailed' && message.params.type !== 'WebSocket' && !message.params.canceled) this.failedLoads.push({url: this.requests.get(message.params.requestId), error: message.params.errorText});
      if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) this.failedResponses.push(message.params.response.url);
      if (message.method === 'Network.webSocketFrameReceived') this.socketFrames++;
      if (message.method === 'Network.webSocketHandshakeResponseReceived' && message.params.response.status === 101) this.socketHandshakes++;
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Network.setCacheDisabled', {cacheDisabled: true});
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Chrome timed out: ${method}`)); }, 30000);
      this.pending.set(id, {resolve, reject, timer});
      this.connection.send(JSON.stringify({id, method, params}));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  async navigate(route) {
    for (let attempt = 0; attempt < 3; attempt++) {
      this.exceptions.length = 0;
      this.failedResponses.length = 0;
      this.failedLoads.length = 0;
      await this.send('Page.navigate', {url: `${baseUrl}${route}`});
      try {
        await waitUntil(() => this.evaluate(`location.pathname === ${JSON.stringify(route)} && document.readyState === 'complete' && [...document.images].every(image => image.complete && image.naturalWidth > 0)`), `${route} and its images to load`);
        return;
      } catch (error) {
        const diagnostic = await this.evaluate(`({path: location.pathname, ready: document.readyState, images: [...document.images].map(image => ({src: image.src, complete: image.complete, width: image.naturalWidth})), resources: performance.getEntriesByType('resource').map(resource => ({name: resource.name, duration: resource.duration}))})`);
        const directory = path.join(reportDir, this.brandId, 'diagnostics');
        await fs.mkdir(directory, {recursive: true});
        const name = `${route === '/' ? 'home' : route.slice(1)}-${Date.now()}`;
        const details = {diagnostic, failedLoads: [...this.failedLoads], exceptions: [...this.exceptions]};
        await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify(details, null, 2) + '\n');
        await this.screenshot(path.join(directory, `${name}.png`));
        const transient = this.failedLoads.some(load => ['net::ERR_CONNECTION_RESET', 'net::ERR_CONTENT_LENGTH_MISMATCH', 'net::ERR_CONNECTION_CLOSED'].includes(load.error));
        if (!transient || this.exceptions.length || attempt === 2) throw error;
        this.transportRetries.push({route, attempt: attempt + 1, failures: details.failedLoads});
        console.log(`[${this.brandId}] Retrying ${route} after a transport failure; diagnostic saved`);
        await sleep(500);
      }
    }
  }

  async screenshot(filename) {
    const metrics = await this.send('Page.getLayoutMetrics');
    const {width, height} = metrics.cssContentSize;
    const viewport = await this.evaluate('({width: innerWidth, height: innerHeight})');
    // Expand the viewport for the capture so fixed footers appear at the bottom
    // of a full-page image, rather than covering the middle of a long form.
    await this.send('Emulation.setDeviceMetricsOverride', {width: viewport.width, height: Math.ceil(height), deviceScaleFactor: 1, mobile: viewport.width < 800});
    try {
      const screenshot = await this.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true, clip: {x: 0, y: 0, width, height, scale: 1}});
      await fs.writeFile(filename, Buffer.from(screenshot.data, 'base64'));
    } finally {
      await this.send('Emulation.setDeviceMetricsOverride', {width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 800});
    }
  }

  async close() {
    if (this.connection?.readyState === WebSocket.OPEN) {
      await this.send('Browser.close').catch(() => {});
      this.connection.close();
    }
    if (this.process?.exitCode === null) this.process.kill('SIGTERM');
    // The temporary browser profile stays in /tmp for diagnostics.
  }
}

async function checkPage(chrome, brandId, route, width) {
  const previousHandshakes = chrome.socketHandshakes;
  const previousFrames = chrome.socketFrames;
  await chrome.navigate(route);
  if (route === '/') {
    await waitUntil(() => chrome.evaluate(`['Mining', 'Waiting'].includes(document.getElementById('status').textContent) && document.getElementById('hash').textContent.endsWith(' kH/s')`), 'live dashboard statistics');
    await waitUntil(() => chrome.socketFrames > previousFrames && chrome.socketHandshakes > previousHandshakes, 'WebSocket handshake and statistics');
  }
  const result = await chrome.evaluate(`(() => {
    const nav = [...document.querySelectorAll('.topnav a')];
    const header = document.querySelector('header');
    return {
      brand: document.body.dataset.brand,
      title: document.title,
      imageCount: document.images.length,
      imagesLoaded: [...document.images].every(image => image.complete && image.naturalWidth > 0),
      overflow: document.documentElement.scrollWidth > innerWidth,
      navigation: nav.map(link => link.getAttribute('href')),
      navVisible: nav.every(link => { const rect = link.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }),
      activePage: document.querySelector('[aria-current="page"]').getAttribute('href'),
      headerFixed: getComputedStyle(header).position === 'fixed',
      footerFixed: getComputedStyle(document.querySelector('footer')).position === 'fixed',
      mainBelowHeader: document.querySelector('main').getBoundingClientRect().top >= header.getBoundingClientRect().bottom,
      footerClearance: parseFloat(getComputedStyle(document.body).paddingBottom) >= document.querySelector('footer').getBoundingClientRect().height,
      repository: document.querySelector('footer a').href,
      versionResolved: !document.querySelector('footer').textContent.includes('%VERSION%'),
      chartsDrawn: [...document.querySelectorAll('canvas')].every(canvas => canvas.width > 0 && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(byte => byte !== 0)),
      status: document.getElementById('status')?.textContent,
      hash: document.getElementById('hash')?.textContent,
      temperature: document.getElementById('temperature')?.textContent
    };
  })()`);
  assert.equal(result.brand, brandId);
  assert(result.title.includes(brands[brandId].name));
  assert.equal(result.imageCount, brands[brandId].logo ? 7 : 0);
  assert(result.imagesLoaded && !result.overflow && result.navVisible);
  assert(result.headerFixed && result.footerFixed && result.mainBelowHeader && result.footerClearance);
  assert.equal(result.activePage, route);
  assert.deepEqual(result.navigation, ['/', '/config', '/about']);
  assert.equal(result.repository, 'https://github.com/valerio-vaccaro/EasyMiner');
  assert(result.versionResolved && result.chartsDrawn);
  assert.deepEqual(chrome.exceptions, []);
  assert.deepEqual(chrome.failedResponses, []);
  assert.deepEqual(chrome.failedLoads, []);

  const pageName = route === '/' ? 'home' : route.slice(1);
  const filename = `${pageName}-${width}.png`;
  await chrome.screenshot(path.join(outputDir, brandId, filename));
  if (route === '/config') {
    const presetChecks = await chrome.evaluate(`(() => {
      const form = document.getElementById('configForm');
      const host = form.elements.pool_url, port = form.elements.pool_port;
      const saved = [host.value, port.value];
      const presets = [...document.querySelectorAll('[data-pool]')].map(button => {
        button.click();
        return host.value === button.dataset.pool && port.value === button.dataset.port;
      });
      [host.value, port.value] = saved;
      return {presets, homeMiningPort: document.querySelector('[data-pool="solo.homeminingitalia.org"]').dataset.port,
        formMethod: form.method, formAction: new URL(form.action).pathname,
        passwordTypes: [form.elements.wifi_password.type, form.elements.pool_pass.type],
        actions: [...document.querySelectorAll('.actions form')].map(action => [action.method, new URL(action.action).pathname])};
    })()`);
    assert(presetChecks.presets.every(Boolean), `Pool presets failed: ${JSON.stringify(presetChecks)}`);
    assert.equal(presetChecks.homeMiningPort, '3340');
    assert.equal(presetChecks.formMethod, 'post');
    assert.equal(presetChecks.formAction, '/config');
    assert.deepEqual(presetChecks.passwordTypes, ['password', 'password']);
    assert.deepEqual(presetChecks.actions, [['post', '/config/delete'], ['post', '/reboot']]);
  }
  console.log(`[${brandId}] ${pageName} at ${width}px passed`);
  return {route, width, screenshot: filename, ...result};
}

async function checkBrand(chrome, brandId) {
  const directory = path.join(outputDir, brandId);
  chrome.brandId = brandId;
  await fs.mkdir(directory, {recursive: true});
  chrome.socketFrames = 0;
  chrome.socketHandshakes = 0;
  chrome.transportRetries = [];
  if (brands[brandId].logo) {
    const response = await fetch(`${baseUrl}/logo.png`, {signal: AbortSignal.timeout(10000)});
    assert(response.ok && response.headers.get('content-type') === 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await fs.readFile(path.join(projectDir, brands[brandId].logo)));
  }
  const pages = [];
  for (const width of [1280, 390, 320]) {
    await chrome.send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: width < 800});
    for (const route of ['/', '/config', '/about']) pages.push(await checkPage(chrome, brandId, route, width));
  }

  // Simulate a failed WebSocket and verify HTTP immediately populates all
  // dashboard cards. Reboot/delete/save buttons are never submitted.
  const blocker = await chrome.send('Page.addScriptToEvaluateOnNewDocument', {source: `
    window.WebSocket = class {
      constructor() { setTimeout(() => this.onerror?.(), 0); }
      close() { this.onclose?.(); }
    };
  `});
  const handshakesBeforeFallback = chrome.socketHandshakes;
  await chrome.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  await chrome.navigate('/');
  await waitUntil(() => chrome.evaluate(`document.getElementById('hash').textContent.endsWith(' kH/s') && ['Mining', 'Waiting'].includes(document.getElementById('status').textContent)`), 'HTTP fallback');
  await chrome.screenshot(path.join(directory, 'home-http-fallback-1280.png'));
  assert.equal(chrome.socketHandshakes, handshakesBeforeFallback, 'Fallback test must not establish a WebSocket');
  await chrome.send('Page.removeScriptToEvaluateOnNewDocument', {identifier: blocker.identifier});
  await chrome.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
  assert(await chrome.evaluate(`getComputedStyle(document.querySelector('.background')).display === 'none'`));
  await chrome.send('Emulation.setEmulatedMedia', {features: []});

  const stats = await fetch(`${baseUrl}/api/stats`).then(response => response.json()).then(payload => payload.stats);
  const report = {brand: brandId, checkedAt: new Date().toISOString(), pages, httpFallback: true, reducedMotion: true,
    transportRetries: chrome.transportRetries,
    websocketHandshakes: chrome.socketHandshakes, websocketFrames: chrome.socketFrames,
    mining: stats.mining, hashrate: stats.hashrate, uptimeSeconds: stats.uptimeSeconds, accepted: stats.accepted, rejected: stats.rejected};
  const reportDirectory = path.join(reportDir, brandId);
  await fs.mkdir(reportDirectory, {recursive: true});
  await fs.writeFile(path.join(reportDirectory, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

const chrome = new Chrome();
const reports = [];
let currentBrand;
try {
  await fs.mkdir(outputDir, {recursive: true});
  await chrome.start();
  const allBrands = Object.keys(brands);
  const startIndex = allBrands.indexOf(options.start);
  if (options.flashAll) {
    // Resume a stopped sweep using the completed reports from this same run.
    for (const brandId of allBrands.slice(0, startIndex)) {
      reports.push(JSON.parse(await fs.readFile(path.join(reportDir, brandId, 'checks.json'), 'utf8')));
    }
  }
  for (const brandId of options.flashAll ? allBrands.slice(startIndex) : [options.brand]) {
    if (options.flashAll) {
      await chrome.send('Page.navigate', {url: 'about:blank'});
      currentBrand = brandId;
      await flash(brandId);
    }
    reports.push(await checkBrand(chrome, brandId));
  }
  await fs.writeFile(path.join(reportDir, 'checks.json'), JSON.stringify(reports, null, 2) + '\n');
  await writeGallery(outputDir);
  console.log(`Passed ${reports.length * 9} page checks; saved ${reports.length * 10} screenshots to ${outputDir}`);
} finally {
  await chrome.close();
  if (options.flashAll && currentBrand !== options.restore) await flash(options.restore);
}
