// Build the documentation gallery directly from the firmware screenshots.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brands = {
  base: 'EasyMiner (base)',
  blox: 'BLOXMiner',
  satoshispritz: 'SatoshiSpritzMiner',
  officinebitcoin: 'OfficineBitcoinMiner',
  sbamminer: 'SBAMminer',
};
const pages = {home: 'Dashboard', config: 'Configuration', about: 'About'};

export async function writeGallery(directory = path.join(projectDir, 'docs', 'screenshot')) {
  const destination = path.join(projectDir, 'docs', 'screenshots.html');
  const imageRoot = path.relative(path.dirname(destination), directory).split(path.sep).join('/');
  const sections = [];
  const links = [];
  for (const [brand, name] of Object.entries(brands)) {
    let filenames;
    try { filenames = await fs.readdir(path.join(directory, brand)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const groups = [];
    for (const width of [1280, 390, 320]) {
      const figures = [];
      for (const [page, label] of Object.entries(pages)) {
        const filename = `${page}-${width}.png`;
        if (!filenames.includes(filename)) continue;
        const source = `${imageRoot}/${brand}/${filename}`;
        figures.push(`        <figure class="screenshot-card">
          <a href="${source}"><img loading="lazy" src="${source}" alt="${name}: ${label.toLowerCase()} at ${width} pixels"></a>
          <figcaption>${label}</figcaption>
        </figure>`);
      }
      if (figures.length) groups.push(`      <h3>${width === 1280 ? 'Desktop' : 'Mobile'} · ${width} px</h3>
      <div class="screenshot-grid">
${figures.join('\n')}
      </div>`);
    }
    if (!groups.length) continue;
    links.push(`<a class="button alt" href="#${brand}">${name}</a>`);
    sections.push(`    <section class="screenshot-section" id="${brand}">
      <h2>${name}</h2>
${groups.join('\n')}
    </section>`);
  }
  await fs.writeFile(destination, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="Dashboard, configuration, and about pages for every EasyMiner firmware brand.">
  <title>Screenshots · EasyMiner</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <nav class="nav" aria-label="Documentation"><div class="wrap">
    <a class="brand" href="index.html">⛏️ EasyMiner</a>
    <a href="getting-started.html">Get started</a>
    <a href="boards.html">Boards</a>
    <a href="firmware.html">Firmware</a>
    <a href="screenshots.html" aria-current="page">Screenshots</a>
  </div></nav>
  <main class="wrap">
    <section class="hero">
      <div class="eyebrow">Firmware gallery</div>
      <h1>One miner. Five identities.</h1>
      <p class="lead">Explore each firmware's dashboard, configuration, and about pages on desktop and mobile. Select an image to view it at full size.</p>
      <nav class="actions" aria-label="Firmware versions">${links.join('\n        ')}</nav>
    </section>
${sections.join('\n')}
  </main>
  <footer class="footer"><div class="wrap"><a href="index.html">← EasyMiner home</a></div></footer>
</body>
</html>
`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeGallery(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
}
