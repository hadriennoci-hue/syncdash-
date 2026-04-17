import type { AttributeCollection } from './product-attribute-options'

type AttributeShortValueMap = Record<AttributeCollection, Record<string, Record<string, string>>>

export const ATTRIBUTE_SHORT_VALUE_MAP: AttributeShortValueMap = {
  laptops: {
    category: {
      '2-in-1 Laptop': '2-in-1',
      'Gaming Laptop': 'Gaming',
      'Creator Laptop': 'Creator',
      'Business Laptop': 'Business',
      'Everyday Laptop': 'Everyday',
    },
    gpu: {
      'GeForce RTX 4050': 'RTX 4050',
      'GeForce RTX 4060': 'RTX 4060',
      'GeForce RTX 4070': 'RTX 4070',
      'GeForce RTX 4080': 'RTX 4080',
      'GeForce RTX 4090': 'RTX 4090',
      'Intel Arc Graphics': 'Intel Arc',
      'GeForce RTX™ 5070 Ti': 'RTX 5070 Ti',
      'GeForce RTX™ 5070Ti': 'RTX 5070 Ti',
      'GeForce RTX™ 5070': 'RTX 5070',
      'GeForce RTX™ 5090': 'RTX 5090',
      'GeForce RTX™ 5080': 'RTX 5080',
      'GeForce RTX™ 5060': 'RTX 5060',
      'GeForce RTX™ 5050': 'RTX 5050',
      'GeForce RTX™ 4060': 'RTX 4060',
      'GeForce RTX™ 3050': 'RTX 3050',
      'GeForce RTX™ 2050': 'RTX 2050',
      'Radeon™ 780M Graphics': 'Radeon 780M',
      'Radeon™ Graphics': 'Radeon GPU',
      'Intel® Graphics': 'Intel GPU',
      'Intel® Graphic': 'Intel GPU',
      'Iris® Xe Graphics': 'Iris Xe',
      'Iris Xe Graphics': 'Iris Xe',
      'Arc™ Graphics 140V': 'Arc 140V',
      'Arc™ Graphics': 'Intel Arc',
      'ARC™ 140V GPU': 'Arc 140V',
    },
    model: {
      'TravelMate P4': 'TM P4',
      'Predator Helios 16': 'Helios 16',
      'Predator Triton 14': 'Triton 14',
      'Predator Helios Neo 16': 'HeliosNeo16',
    },
    operating_system: {
      'Windows 11 Home': 'Win 11 Home',
      'Windows 11 Pro': 'Win 11 Pro',
    },
    ports: {
      'Thunderbolt 4': 'TB4',
      'RJ-45 Ethernet': 'RJ45',
      '3.5mm Audio Jack': '3.5mm Jack',
    },
    processor: {
      'Intel Core i5': 'Core i5',
      'Intel Core i7': 'Core i7',
      'Intel Core i9': 'Core i9',
      'Intel Core Ultra 7': 'Core U7',
    },
    processor_generation: {
      'Ryzen 7000 Series': 'Ryzen 7000',
      'Ryzen 8000 Series': 'Ryzen 8000',
      'Ryzen 9000 Series': 'Ryzen 9000',
      'Core Ultra Series 1': 'Core U S1',
      'Core Ultra Series 2': 'Core U S2',
    },
    processor_model: {
      'Intel Core i5': 'Core i5',
      'Intel Core i7': 'Core i7',
      'Intel Core i9': 'Core i9',
      'Intel Core Ultra 5': 'Core U5',
      'Intel Core Ultra 7': 'Core U7',
      'Intel Core Ultra 9': 'Core U9',
      'Snapdragon X Elite': 'SD X Elite',
    },
    series: {
      'Predator Helios': 'Helios',
      'Predator Triton': 'Triton',
      'TravelMate': 'TM',
    },
    storage_type: {
      'PCI Express NVMe 4.0': 'NVMe 4.0',
      'PCI Express NVMe 5.0': 'NVMe 5.0',
      'PCI Express 4.0': 'PCIe 4.0',
    },
  },
  monitor: {
    category: {
      'Gaming Monitor': 'Gaming',
      'Office Monitor': 'Office',
      'Creator Monitor': 'Creator',
      'Ultrawide Monitor': 'Ultrawide',
    },
    color_gamut: {
      '99% Adobe RGB': '99% Adobe',
    },
    gsync_freesync: {
      'FreeSync Premium': 'FS Premium',
      'FreeSync Premium Pro': 'FS Prem Pro',
      'G-SYNC Compatible': 'G-SYNC Comp',
    },
    model: {
      'Predator X34 V': 'X34 V',
      'Predator XB273K': 'XB273K',
    },
    panel_type: {
      'In-plane Switching (IPS) Technology': 'IPS',
      'Technology In-plane Switching (IPS)': 'IPS',
      'Näyttöruudun IPS Panel Technology': 'IPS',
      'ComfyView (matte) IPS Technology': 'IPS Matte',
      'ComfyView (Matte) In-plane Switching (IPS) Technology': 'IPS Matte',
      'ComfyView (matte) Technology In-plane Switching (IPS)': 'IPS Matte',
      'ComfyView (matte) IPS Panel Technology': 'IPS Matte',
      'ComfyView (matte) In-plane Switching (IPS) technologieEyesafe': 'IPS Matte',
      'ComfyView (matte) Technology In-plane Switching (IPS) Eyesafe': 'IPS Matte',
      'ComfyView (matte) Näyttöruudun IPS Panel tekniikkaSilmäsuojaus': 'IPS Matte',
      'ComfyView (matte) Technology IPSEyesafe': 'IPS Matte',
      'Vertical Alignment (VA)': 'VA',
      'Vertical Alignment': 'VA',
      'CineCrystal (Glare)': 'Glare',
      'CineCrystal (glanzend)': 'Glare',
      'CineCrystal (riflesso)': 'Glare',
      'CineCrystal (Éblouissement)': 'Glare',
      'CineCrystal (häikäisevä)': 'Glare',
      'CineCrystal (glanzend) In-plane Switching (IPS) Technology': 'IPS Glare',
      'CineCrystal (Glare) In-plane Switching (IPS) Technology': 'IPS Glare',
      'CineCrystal (Glare) IPS Technology': 'IPS Glare',
      'Advanced Hyper Viewing Angle (AHVA)': 'AHVA',
      'IPS Technology': 'IPS',
      'ComfyView (matte) Twisted nematic (TN)': 'TN Matte',
      'ComfyView (matte) Nématique Torsadé (TN)': 'TN Matte',
      'ComfyView (matte) Technology Twisted nematic (TN)': 'TN Matte',
      'ComfyView (Matte) Twisted nematic (TN)': 'TN Matte',
    },
    ports: {
      '3.5mm Audio Out': '3.5mm Out',
      'DisplayPort 1.4': 'DP 1.4',
    },
    refresh_rate: {
      'Vertical Frequency': 'Vert Freq',
    },
    resolution: {
      '7680x4320@60Hz': '8K@60Hz',
    },
  },
  mice: {},
}

function normalizeValue(raw: string): string {
  return raw.trim().toLowerCase()
}

function normalizeLoose(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function shortenGraphics(value: string): string | null {
  const normalized = normalizeLoose(value)

  if (normalized.includes('geforce rtx')) {
    const tiMatch = normalized.match(/rtx\s*(\d{4})\s*ti\b/)
    if (tiMatch) return `RTX ${tiMatch[1]} Ti`

    const seriesMatch = normalized.match(/rtx\s*(\d{4})\b/)
    if (seriesMatch) return `RTX ${seriesMatch[1]}`
  }

  if (normalized.includes('radeon') && normalized.includes('780m')) return 'Radeon 780M'
  if (normalized.includes('radeon') && normalized.includes('graphics')) return 'Radeon GPU'
  if (normalized.includes('intel') && normalized.includes('graphic')) return 'Intel GPU'
  if (normalized.includes('iris xe')) return 'Iris Xe'
  if (normalized.includes('arc') && normalized.includes('140v')) return 'Arc 140V'
  if (normalized.includes('arc') && normalized.includes('graphics')) return 'Intel Arc'

  return null
}

function shortenPanelType(value: string): string | null {
  const normalized = normalizeLoose(value)

  if (normalized.includes('twisted nematic') || normalized.includes('torsade (tn)')) return 'TN Matte'
  if (normalized.includes('comfyview') && normalized.includes('ips')) return 'IPS Matte'
  if (normalized.includes('cinecrystal') && normalized.includes('ips')) return 'IPS Glare'
  if (normalized.includes('cinecrystal')) return 'Glare'
  if (normalized.includes('ahva')) return 'AHVA'
  if (normalized.includes('va') || normalized.includes('vertical alignment')) return 'VA'
  if (normalized.includes('ips')) return 'IPS'

  return null
}

function shortenStorageType(value: string): string | null {
  const normalized = normalizeLoose(value)
  if (normalized.includes('nvme') && normalized.includes('5.0')) return 'NVMe 5.0'
  if (normalized.includes('nvme') && normalized.includes('4.0')) return 'NVMe 4.0'
  if (normalized.includes('pci express 4.0')) return 'PCIe 4.0'
  return null
}

export function getShortAttributeValue(
  collection: AttributeCollection,
  key: string,
  value: string,
): string | null {
  const entry = ATTRIBUTE_SHORT_VALUE_MAP[collection]?.[key.trim().toLowerCase()]
  if (!entry) return null
  const normalized = normalizeValue(value)

  for (const [longValue, shortValue] of Object.entries(entry)) {
    if (normalizeValue(longValue) === normalized || normalizeValue(shortValue) === normalized) {
      return shortValue
    }
  }

  const normalizedKey = key.trim().toLowerCase()
  if (normalizedKey === 'gpu') return shortenGraphics(value)
  if (normalizedKey === 'panel_type') return shortenPanelType(value)
  if (normalizedKey === 'storage_type') return shortenStorageType(value)
  if (normalizedKey === 'refresh_rate' && normalizeLoose(value).includes('vertical frequency')) return 'Vert Freq'
  if (normalizedKey === 'resolution' && normalizeLoose(value).includes('7680x4320@60hz')) return '8K@60Hz'

  return null
}
