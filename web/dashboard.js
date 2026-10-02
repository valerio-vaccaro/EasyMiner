'use strict';

const element = id => document.getElementById(id);
const history = [];
const sampleInterval = 10;
const historyLimit = 60;
const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
let previousStats = null;
let polling = false;
let reconnectDelay = 1000;

function shareRain(accepted) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const icons = accepted ? ['🧀', '🍫', '🍷', '⛷️', '🏔️', '🛷', '🧈'] : ['🍅', '🥬', '🥕', '🥒', '🍆', '🥦', '🍌'];
  const container = document.createElement('div');
  container.className = 'rain';
  container.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 36; i++) {
    const drop = document.createElement('span');
    drop.className = 'drop';
    drop.textContent = icons[Math.floor(Math.random() * icons.length)];
    drop.style.left = `${Math.random() * 96}%`;
    drop.style.animationDelay = `${Math.random() * .35}s`;
    drop.style.fontSize = `${1.2 + Math.random() * 1.2}rem`;
    container.appendChild(drop);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 3000);
}

function drawChart(id, key, color) {
  const canvas = element(id);
  const context = canvas.getContext('2d');
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);

  const left = 50, right = width - 12, top = 14, bottom = height - 28;
  const values = history.map(point => point[key]).filter(Number.isFinite);
  const maximum = Math.max(...values, 1);
  context.font = '11px system-ui';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const value = maximum * (1 - i / 4);
    const y = top + (bottom - top) * i / 4;
    context.strokeStyle = 'rgba(155,168,184,.22)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
    context.fillStyle = '#aebbd0';
    context.fillText(value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(value < 10 ? 1 : 0), left - 6, y);
  }
  const first = history[0]?.time || 0;
  const duration = (history[history.length - 1]?.time || first) - first;
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillText('0s', left, bottom + 8);
  context.textAlign = 'right';
  context.fillText(`${duration}s`, right, bottom + 8);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  let connected = false;
  history.forEach(point => {
    if (!Number.isFinite(point[key])) { connected = false; return; }
    const x = left + (point.time - first) / Math.max(duration, 1) * (right - left);
    const y = bottom - point[key] / maximum * (bottom - top);
    if (connected) context.lineTo(x, y);
    else context.moveTo(x, y);
    connected = true;
  });
  context.stroke();
}

function drawCharts() {
  drawChart('hashchart', 'hashrate', accent);
  drawChart('sharechart', 'accepted', '#55c2ff');
  drawChart('tempchart', 'temperature', '#63e6be');
  drawChart('memchart', 'memory', '#55c2ff');
}

function show(payload) {
  const stats = payload.stats || payload;
  const uptime = stats.uptimeSeconds || 0;
  const rebooted = previousStats && uptime < previousStats.uptimeSeconds;
  if (rebooted) history.length = 0;
  if (previousStats && !rebooted) {
    if (stats.accepted > previousStats.accepted) shareRain(true);
    if (stats.rejected > previousStats.rejected) shareRain(false);
  }
  previousStats = stats;
  const temperature = Number.isFinite(stats.chipTemperature) && stats.chipTemperature > -40 ? stats.chipTemperature : null;
  element('hash').textContent = `${((stats.hashrate || 0) / 1000).toFixed(1)} kH/s`;
  element('shares').textContent = `${stats.accepted || 0} / ${stats.rejected || 0}`;
  element('templates').textContent = stats.templates || 0;
  element('blocks').textContent = stats.blocks || 0;
  element('pool').textContent = stats.pool || 'offline';
  element('wallet').textContent = stats.wallet || 'not configured';
  element('poolDifficulty').textContent = stats.poolDifficulty > 0 ? stats.poolDifficulty.toFixed(6) : 'waiting';
  element('temperature').textContent = temperature === null ? 'waiting' : `${temperature.toFixed(1)} °C`;
  element('uptime').textContent = `${Math.floor(uptime / 86400)}d ${Math.floor(uptime % 86400 / 3600)}h ${Math.floor(uptime % 3600 / 60)}m`;
  element('freeHeap').textContent = stats.freeHeap ? `${Math.round(stats.freeHeap / 1024)} KB` : 'waiting';
  element('minFreeHeap').textContent = stats.minFreeHeap ? `${Math.round(stats.minFreeHeap / 1024)} KB` : 'waiting';
  element('cpuMHz').textContent = stats.cpuMHz ? `${stats.cpuMHz} MHz` : 'waiting';
  element('status').textContent = stats.mining ? 'Mining' : 'Waiting';

  // HTTP polling and WebSocket broadcasts can arrive together. Keep one point
  // per ten-second bucket so the chart's time scale remains accurate.
  const point = {time: uptime, hashrate: stats.hashrate || 0, accepted: stats.accepted || 0, temperature, memory: stats.freeHeap ? stats.freeHeap / 1024 : null};
  const last = history[history.length - 1];
  if (last && Math.floor(last.time / sampleInterval) === Math.floor(uptime / sampleInterval)) history[history.length - 1] = point;
  else history.push(point);
  if (history.length > historyLimit) history.shift();
  drawCharts();
}

async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch('/api/stats', {cache: 'no-store', signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    show(await response.json());
  } catch {
    element('status').textContent = 'Reconnecting...';
  } finally {
    polling = false;
  }
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const connection = new WebSocket(`${protocol}//${location.hostname}:81/`);
  connection.onopen = () => { reconnectDelay = 1000; };
  connection.onmessage = event => {
    try { show(JSON.parse(event.data)); }
    catch { refresh(); }
  };
  connection.onerror = () => connection.close();
  connection.onclose = () => {
    refresh();
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
  };
}

window.addEventListener('resize', drawCharts);
refresh();
connect();
setInterval(refresh, sampleInterval * 1000);
