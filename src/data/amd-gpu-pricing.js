const AMD_GPU_MODEL_VERSION = 'amd_dynamic_v9';

const amdGpuPricingModels = [
  ['RX 9070 XT', 9, 16, 21990, 9500, 2025],
  ['RX 9070', 9, 16, 18990, 8500, 2025],
  ['RX 9060 XT', 9, 12, 13990, 6000, 2025],
  ['RX 9060', 9, 8, 9990, 4200, 2025],
  ['RX 7900 XTX', 7, 24, 32990, 15000, 2022],
  ['RX 7900 XT', 7, 20, 26990, 11000, 2022],
  ['RX 7900 GRE', 7, 16, 18990, 8500, 2023],
  ['RX 7800 XT', 7, 16, 17990, 8000, 2023],
  ['RX 7700 XT', 7, 12, 15490, 6000, 2023],
  ['RX 7600 XT', 7, 16, 11490, 5000, 2024],
  ['RX 7600', 7, 8, 8990, 3500, 2023],
  ['RX 6950 XT', 6, 16, 32990, 9500, 2022],
  ['RX 6900 XT', 6, 16, 31990, 9000, 2020],
  ['RX 6800 XT', 6, 16, 22990, 8000, 2020],
  ['RX 6800', 6, 16, 19990, 7000, 2020],
  ['RX 6750 XT', 6, 12, 16990, 5500, 2022],
  ['RX 6700 XT', 6, 12, 15990, 5000, 2021],
  ['RX 6650 XT', 6, 8, 11990, 3600, 2022],
  ['RX 6600 XT', 6, 8, 12490, 3400, 2021],
  ['RX 6600', 6, 8, 9990, 3000, 2021],
  ['RX 5700 XT', 5, 8, 14990, 2400, 2019],
  ['RX 5700', 5, 8, 12990, 2100, 2019],
  ['RX 5600 XT', 5, 6, 9990, 1800, 2020],
  ['RX 580', 4, 8, 8290, 1400, 2017]
].map(([canonicalModel, generation, vramGb, launchPriceNtd, floorPriceNtd, releaseYear]) => ({
  canonicalModel,
  generation,
  vramGb,
  launchPriceNtd,
  floorPriceNtd,
  releaseYear,
  latestGeneration: 9,
  landingCoefficient: -0.040,
  marketFactor: 0,
  modelVersion: AMD_GPU_MODEL_VERSION,
  aliases: canonicalModel === 'RX 580'
    ? ['RX 580 8G', 'RX 580 8GB', 'Radeon RX 580', 'Radeon RX 580 8GB']
    : [`Radeon ${canonicalModel}`, `AMD Radeon ${canonicalModel}`]
}));

module.exports = { AMD_GPU_MODEL_VERSION, amdGpuPricingModels };
