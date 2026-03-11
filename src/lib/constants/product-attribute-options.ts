export type AttributeCollection = 'laptops' | 'monitor'
export type AttributeBrand = 'acer' | 'predator'

type AttributeOptionsMap = Record<string, string[]>

export const ATTRIBUTE_OPTIONS: Record<AttributeCollection, AttributeOptionsMap> = {
  laptops: {
    brand: ['Acer', 'Predator'],
    category: ['Everyday', 'Business', 'Chromebook', 'Ultra-thin', 'Gaming'],
    series: ['Aspire Go', 'Aspire Vero', 'Swift Go', 'Swift', 'TravelMate', 'Helios', 'Helios Neo', 'Triton'],
    screen_size: ['14"', '15.6"', '16"', '18"'],
    screen_resolution: ['1920x1080 (FHD)', '1920x1200 (WUXGA)', '2240x1400 (WQXGA)', '2560x1600 (WQXGA)'],
    screen_type: ['IPS', 'OLED', 'LCD', 'Active Matrix TFT LCD', 'ComfyView (Matte)', 'TN', 'Mini LED'],
    refresh_rate: ['60Hz', '240Hz', '250Hz'],
    touchscreen: ['Yes', 'No'],
    processor_brand: ['Intel', 'AMD'],
    processor_generation: ['13th Gen Intel Core', '14th Gen Intel Core', 'Intel Core Ultra'],
    processor_cores: ['6', '20', '24'],
    gpu_brand: ['Intel', 'NVIDIA'],
    ram: ['8GB', '16GB', '32GB', '64GB'],
    ram_type: ['DDR4', 'DDR5', 'LPDDR5', 'LPDDR5X'],
    ram_max: ['32GB', '64GB'],
    storage_type: ['SSD (NVMe PCIe Gen3/Gen4)', 'eMMC', 'UFS Flash'],
    storage_capacity: ['64GB', '128GB', '256GB', '512GB', '1TB', '2TB'],
    battery_capacity: ['50Wh', '65Wh', '4-cell Li-Ion'],
    battery_life: ['Up to 10h', 'Up to 15h'],
    wifi: ['Wi-Fi 6', 'Wi-Fi 6E', 'Wi-Fi 7', 'IEEE 802.11 a/b/g/n/ac/ax', 'Killer Wi-Fi 6E/7'],
    bluetooth: ['Bluetooth 5.1+', 'Bluetooth 5.2', 'Bluetooth 5.3+'],
    operating_system: ['Windows 11 Home', 'Windows 11 Pro', 'ChromeOS'],
    color: ['Silver', 'Pure Silver', 'Abyssal Black'],
  },
  monitor: {
    brand: ['Acer', 'Predator'],
    series: ['Nitro (VG/XV/XZ/KG/QG/ED)', 'X27U', 'XB3', 'X32', 'X34', 'Z57'],
    screen_size: ['23.8"', '24"', '26.5"', '27"', '31.5"', '34"', '37.5"', '44.5"', '49"', '57"'],
    resolution: ['1920x1080 (FHD)', '2560x1440 (QHD/WQHD)', '3440x1440 (UWQHD)', '3840x2160 (4K UHD)', '5120x1440 (DQHD)', '7680x2160 (DUHD)'],
    aspect_ratio: ['16:9', '21:9', '32:9'],
    panel_technology: ['IPS', 'Agile-Splendor IPS', 'VA', 'TN Film', 'OLED', 'QD-OLED', 'VA Mini LED'],
    refresh_rate: ['75Hz', '120Hz', '144Hz', '160Hz', '165Hz', '170Hz', '180Hz', '200Hz', '240Hz', '300Hz', '360Hz', '500Hz'],
    response_time: ['5ms', '4ms (GTG)', '1ms', '0.5ms', '0.03ms', '0.01ms-0.03ms', '30µs GTG'],
    brightness: ['250 nit', '300 nit', '350 nit', '400 nit', '1000 nit'],
    contrast_ratio: ['1,000:1 (native)', '2,500:1', '100,000,000:1 / 100 Million:1 (ACM)'],
    color_depth: ['16.7 million colors (~8-bit)', '1.07 billion colors (~10-bit)'],
    color_gamut: ['DCI-P3 90%', 'DCI-P3 98.5%', 'DCI-P3 99%', 'Adobe RGB'],
    hdr_certification: ['HDR10', 'HDR400 mode', 'VESA DisplayHDR True Black 400', 'VESA DisplayHDR True Black 500'],
    adaptive_sync_technology: ['AMD FreeSync', 'AMD FreeSync Premium', 'AMD FreeSync Premium Pro', 'NVIDIA G-SYNC Compatible', 'NVIDIA G-SYNC Pulsar'],
    backlight_technology: ['LED', 'OLED', 'Mini LED', 'VA Mini LED'],
    curvature: ['Flat', '1500R', '2300R'],
    speakers: ['No', 'Yes (2 speakers)', '2W x2', '5W x2', '10W x2'],
    ports: ['HDMI 2.1', 'HDMI', 'DisplayPort', 'USB Type-C', 'USB/USB Hub', 'VGA', 'Audio line-out', 'Headphone jack'],
    vesa_mount: ['75x75', '100x100'],
    adjustability: ['Tilt', 'Swivel', 'Pivot', 'Height adjustment', 'Wall mountable'],
    power_consumption: ['<30W', '60W', '<92W'],
    color: ['Black', 'Black/Red'],
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
