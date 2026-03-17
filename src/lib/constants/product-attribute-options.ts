export type AttributeCollection = 'laptops' | 'monitor'
export type AttributeBrand = 'acer' | 'predator'

type AttributeOptionsMap = Record<string, string[]>

export const ATTRIBUTE_OPTIONS: Record<AttributeCollection, AttributeOptionsMap> = {
  laptops: {
    brand: ['Acer', 'Predator'],
    model: ['Aspire 3', 'Aspire 5', 'Swift Go 14', 'Swift X 14', 'TM P4', 'Extensa 15', 'Nitro V 15', 'Nitro 16', 'HeliosNeo16', 'Helios 16', 'Triton 14'],
    category: ['Ultrabook', 'Gaming', 'Business', 'Creator', 'Everyday', '2-in-1'],
    series: ['Aspire', 'Swift', 'Nitro', 'Helios', 'Triton', 'TM', 'Extensa'],
    screen_size: ['13.3', '14', '15.6', '16', '17.3', '18'],
    resolution: ['1920x1080', '1920x1200', '2560x1600', '2880x1800', '3840x2160', '8K@60Hz'],
    processor: ['Core i5', 'Core i7', 'Core i9', 'Core U7', 'AMD Ryzen 5', 'AMD Ryzen 7', 'AMD Ryzen 9'],
    screen_type: ['IPS', 'OLED', 'Mini LED'],
    refresh_rate: ['60', '90', '120', '144', '165', '240'],
    touchscreen: ['No', 'Yes'],
    processor_brand: ['Intel', 'AMD', 'Qualcomm'],
    processor_model: ['Core i5', 'Core i7', 'Core i9', 'Core U5', 'Core U7', 'Core U9', 'AMD Ryzen 5', 'AMD Ryzen 7', 'AMD Ryzen 9', 'SD X Elite'],
    processor_generation: ['12th Gen', '13th Gen', '14th Gen', 'Core U S1', 'Core U S2', 'Ryzen 7000', 'Ryzen 8000', 'Ryzen 9000'],
    processor_cores: ['6', '8', '10', '12', '14', '16', '24'],
    gpu_brand: ['NVIDIA', 'AMD', 'Intel'],
    gpu: ['Intel Arc', 'RTX 4050', 'RTX 4060', 'RTX 4070', 'RTX 4080', 'RTX 4090'],
    ram: ['8', '16', '32', '64'],
    ram_type: ['DDR4', 'DDR5', 'LPDDR5', 'LPDDR5X'],
    ram_max: ['16', '32', '64', '96'],
    storage_type: ['NVMe SSD', 'SATA SSD', 'NVMe 4.0', 'NVMe 5.0', 'PCIe 4.0'],
    storage: ['256GB SSD', '512GB SSD', '1TB SSD', '2TB SSD', '4TB SSD'],
    battery_life: ['6', '8', '10', '12', '14'],
    weight: ['<1.4', '1.4-1.8', '1.8-2.3', '>2.3'],
    wifi: ['Wi-Fi 6', 'Wi-Fi 6E', 'Wi-Fi 7'],
    bluetooth: ['5.1', '5.2', '5.3', '5.4'],
    ports: ['USB-A', 'USB-C', 'TB4', 'HDMI 2.1', 'microSD', '3.5mm Jack', 'RJ45'],
    operating_system: ['Win 11 Home', 'Win 11 Pro', 'Linux', 'No OS'],
    color: ['Black', 'White', 'Silver', 'Blue', 'Gray'],
  },
  monitor: {
    brand: ['Acer', 'Predator'],
    model: ['Nitro KG241Y', 'Nitro XV272U', 'Acer CB272', 'XB273K', 'X34 V', 'Predator X45'],
    category: ['Gaming', 'Office', 'Creator', 'Ultrawide'],
    series: ['Nitro', 'Acer CB', 'Predator XB', 'Predator X'],
    screen_size: ['23.8', '24', '27', '31.5', '34', '45'],
    resolution: ['1920x1080', '2560x1440', '3440x1440', '3840x2160'],
    screen_resolution: ['1920x1080', '2560x1440', '3440x1440', '3840x2160'],
    panel_type: ['IPS', 'IPS Matte', 'IPS Glare', 'VA', 'TN Matte', 'OLED', 'Mini LED', 'Glare', 'AHVA'],
    screen_type: ['IPS', 'VA', 'OLED', 'Mini LED'],
    refresh_rate: ['60', '75', '120', '144', '165', '180', '240', 'Vert Freq'],
    response_time: ['0.03', '0.5', '1', '2', '4'],
    aspect_ratio: ['16:9', '21:9', '32:9'],
    curved: ['No', '1000R', '1500R'],
    brightness: ['250', '300', '400', '600', '1000'],
    contrast_ratio: ['1000:1', '3000:1', '1000000:1'],
    hdr: ['None', 'HDR400', 'HDR600', 'HDR1000'],
    gsync_freesync: ['None', 'G-SYNC Comp', 'G-SYNC', 'FreeSync', 'FS Premium', 'FS Prem Pro'],
    color_gamut: ['95% sRGB', '99% sRGB', '95% DCI-P3', '99% Adobe'],
    ports: ['HDMI 2.0', 'HDMI 2.1', 'DP 1.4', 'USB-C', 'USB Hub', '3.5mm Out'],
    vesa_mount: ['75x75', '100x100'],
    color: ['Black', 'White', 'Silver'],
  },
}

const BRAND_KEYWORDS: Record<AttributeBrand, string[]> = {
  acer: ['aspire', 'swift', 'travelmate', 'nitro', 'acer'],
  predator: ['predator', 'helios', 'triton', 'xb', 'x27u', 'x32', 'x34', 'z57'],
}

export function getAttributeOptions(
  collection: AttributeCollection,
  brand?: AttributeBrand
): AttributeOptionsMap {
  const base = ATTRIBUTE_OPTIONS[collection]
  if (!brand) return base

  const brandName = brand === 'acer' ? 'Acer' : 'Predator'
  const keywords = BRAND_KEYWORDS[brand]
  const seriesValues = (base.series ?? []).filter((value) => {
    const lower = value.toLowerCase()
    if (lower === brand.toLowerCase()) return true
    if (lower.includes(brandName.toLowerCase())) return true
    return keywords.some((kw) => lower.includes(kw))
  })

  return {
    ...base,
    brand: [brandName],
    ...(seriesValues.length > 0 ? { series: seriesValues } : {}),
  }
}
