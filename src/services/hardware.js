function getDynamicGPUScore(gpuString) {
  if (!gpuString || gpuString === 'UNKNOWN') return 1000;
  const text = gpuString.toUpperCase().replace(/[\s-]/g, '');
  const nvidiaMatch = text.match(/(RTX|GTX)(\d{1,2})(\d{2})(TI|SUPER)?/);

  if (nvidiaMatch) {
    const generation = parseInt(nvidiaMatch[2], 10);
    const tier = parseInt(nvidiaMatch[3], 10);
    const suffix = nvidiaMatch[4] || '';
    const generationIndex = generation === 16 ? 1.5 : generation / 10;
    let baseScore = 5000;
    if (tier === 50) baseScore = 6000;
    else if (tier === 60) baseScore = 10000;
    else if (tier === 70) baseScore = 16000;
    else if (tier === 80) baseScore = 22000;
    else if (tier === 90) baseScore = 28000;

    const generationMultiplier = Math.pow(1.25, generationIndex - 3);
    let suffixMultiplier = 1;
    if (suffix === 'TI') suffixMultiplier = 1.15;
    if (suffix === 'SUPER') suffixMultiplier = 1.10;
    return Math.round(baseScore * generationMultiplier * suffixMultiplier);
  }

  const amdMatch = text.match(/(RX)(\d)(\d{2})(0)(XTX|XT|GRE)?/);
  if (amdMatch) {
    const generation = parseInt(amdMatch[2], 10);
    const tier = parseInt(amdMatch[3], 10);
    const suffix = amdMatch[5] || '';
    let baseScore = 4500;
    if (tier === 60) baseScore = 9000;
    else if (tier === 70) baseScore = 14000;
    else if (tier === 80) baseScore = 20000;
    else if (tier === 90) baseScore = 26000;

    const generationMultiplier = Math.pow(1.20, generation - 6);
    let suffixMultiplier = 1;
    if (suffix === 'XTX') suffixMultiplier = 1.20;
    if (suffix === 'XT') suffixMultiplier = 1.15;
    if (suffix === 'GRE') suffixMultiplier = 1.10;
    return Math.round(baseScore * generationMultiplier * suffixMultiplier);
  }

  return 1000;
}

function getDynamicCPUScore(cpuString) {
  if (!cpuString || cpuString === 'UNKNOWN') return 2000;
  const text = cpuString.toUpperCase().replace(/\s+/g, '');
  const intelMatch = text.match(/I([3579])-(\d{2})(\d{3})([KFSX]*)/);

  if (intelMatch) {
    const series = parseInt(intelMatch[1], 10);
    const generation = parseInt(intelMatch[2], 10);
    const suffix = intelMatch[4] || '';
    let baseScore = 4000;
    if (series === 3) baseScore = 6000;
    else if (series === 5) baseScore = 9000;
    else if (series === 7) baseScore = 14000;
    else if (series === 9) baseScore = 19000;

    const generationMultiplier = Math.pow(1.15, generation - 12);
    let suffixMultiplier = 1;
    if (suffix.includes('K')) suffixMultiplier = 1.10;
    if (suffix.includes('T') || suffix.includes('U')) suffixMultiplier = 0.8;
    return Math.round(baseScore * generationMultiplier * suffixMultiplier);
  }

  const amdMatch = text.match(/(?:RYZEN|R)([3579])-?(\d)(\d{2})(0)([XG3DF]*)/);
  if (amdMatch) {
    const series = parseInt(amdMatch[1], 10);
    const generation = parseInt(amdMatch[2], 10);
    const suffix = amdMatch[5] || '';
    let baseScore = 4000;
    if (series === 3) baseScore = 5500;
    else if (series === 5) baseScore = 8500;
    else if (series === 7) baseScore = 13500;
    else if (series === 9) baseScore = 18500;

    const generationMultiplier = Math.pow(1.15, (generation - 5) / 2);
    let suffixMultiplier = 1;
    if (suffix.includes('X3D')) suffixMultiplier = 1.25;
    if (suffix.includes('X')) suffixMultiplier = 1.08;
    if (suffix.includes('G')) suffixMultiplier = 0.95;
    return Math.round(baseScore * generationMultiplier * suffixMultiplier);
  }

  if (text.includes('I9') || text.includes('RYZEN9')) return 15000;
  if (text.includes('I7') || text.includes('RYZEN7')) return 12000;
  if (text.includes('I5') || text.includes('RYZEN5')) return 8500;
  if (text.includes('I3') || text.includes('RYZEN3')) return 5500;
  return 2000;
}

function extractCPU(text) {
  const match = String(text || '').match(/(i[3579]-\d{4,5}[A-Z]*|Ultra\s*[579]\s*\d{3}[A-Z]*|Ryzen\s*\d\s*\d{4}[A-Z\d]*|R[3579]-\d{4}[A-Z\d]*|TR\s*(?:PRO\s*)?\d{4}[A-Z]*|(?:i[3579]|Ryzen\s*[3579])處理器)/i);
  return match ? match[0].toUpperCase().replace(/\s+/g, '') : 'UNKNOWN';
}

function extractGPU(text) {
  const match = String(text || '').match(/(RTX|GTX|RX)\s*-?\s*\d{4}\s*(Ti|SUPER|XTX|XT|GRE)?/i);
  return match ? match[0].toUpperCase().replace(/[\s-]/g, '') : 'UNKNOWN';
}

function extractRAM(text) {
  const match = String(text || '').match(/\b(8|16|32|64|128)\s*(?:GB|G)\b/i);
  return match ? `${parseInt(match[1], 10)}GB` : 'UNKNOWN';
}

function getRamBonusScore(ramString) {
  if (ramString === '128GB') return 6500;
  if (ramString === '64GB') return 4500;
  if (ramString === '32GB') return 3500;
  if (ramString === '16GB') return 1800;
  if (ramString === '8GB') return 900;
  if (ramString === '4GB') return 400;
  if (ramString === '2GB') return 100;
  return 0;
}

function extractOS(text) {
  const match = String(text || '').match(/(Win\s*11|Windows\s*11|W11|Win\s*10|Windows\s*10|W10)([\w\u4e00-\u9fa5]*)/i);
  if (!match) return 'UNKNOWN';
  let version = match[1].toUpperCase().replace(/\s+/g, '');
  const edition = match[2] || '';
  if (version === 'WINDOWS11' || version === 'W11') version = 'WIN11';
  if (version === 'WINDOWS10' || version === 'W10') version = 'WIN10';
  return edition.includes('專業') || edition.toUpperCase().includes('PRO')
    ? `${version} Pro`
    : version;
}

function getOsBonusScore(osString) {
  if (osString.includes('Pro')) return 2000;
  if (osString.includes('WIN11') || osString.includes('WIN10')) return 1500;
  return 0;
}

module.exports = {
  extractCPU,
  extractGPU,
  extractRAM,
  extractOS,
  getDynamicCPUScore,
  getDynamicGPUScore,
  getRamBonusScore,
  getOsBonusScore
};
