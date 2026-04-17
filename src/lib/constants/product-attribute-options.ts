export type AttributeCollection =
  | 'laptops'
  | 'monitor'
  | 'mice'
  | 'laptop_bags'
  | 'headsets'
  | 'keyboards'
  | 'controllers'
  | 'docking_stations'
  | 'connectivity'
  | 'storage'
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
  mice: {
    product_subtype: ['Mouse', 'Gaming mouse', 'Vertical mouse', 'Keyboard and mouse combo', 'Mousepad'],
    dpi: ['1600', '7200', '16000', '19000'],
    sensor: ['Optical', 'PixArt 3370', 'PixArt 3389'],
    buttons: ['3', '6', '10'],
    connection: ['Wired USB', '2.4GHz Wireless', 'Bluetooth 5.0', '2.4GHz Wireless + Bluetooth 5.0'],
    polling_rate: ['125Hz', '2000Hz'],
    response_time: ['1ms'],
    ips: ['400 IPS'],
    lighting: ['RGB', '7-color lighting', '16.8M RGB'],
    scroll: ['Hyper-fast infinite scroll'],
    hand_orientation: ['Right-handed'],
    battery: ['2 x AAA', 'Rechargeable'],
    battery_life: ['Up to 120 hours'],
    charging_time: ['3 hours'],
    charging_cable: ['Micro-USB'],
    receiver: ['USB receiver', 'USB Nano receiver'],
    keyboard_shortcuts: ['11 shortcuts'],
    keystroke_life: ['5 million keystrokes'],
    surface: ['Low-friction fabric', 'Smooth fabric', 'Recycled surface'],
    base: ['Non-slip rubber', 'Recycled natural rubber'],
    material: ['Recycled materials', 'Non-hazardous materials'],
    dimensions: ['220x180x3mm'],
    thickness: ['3mm'],
    wrist_support: ['Yes'],
    compatibility: ['Windows 7+', 'Mac OS'],
    color: ['Black', 'Gray'],
  },
  laptop_bags: {
    product_subtype: ['Backpack', 'Sleeve', 'Carrying case', 'Luggage'],
    laptop_size: ['11.6"', '14"', '15.6"', '16"', '17"', '18"', '22"'],
    capacity: ['25L', '25L + 2.5L'],
    carry_style: ['Backpack', 'Sleeve', 'Briefcase', '3-in-1', 'Luggage'],
    material: ['rPET', 'Synthetic fabric', 'Durable fabric', 'PU leather', 'Aluminum alloy'],
    water_resistant: ['Yes'],
    compartments: ['Laptop compartment', 'Front pocket', 'Organizer', 'Power adapter sleeve', 'Multiple compartments'],
    features: ['TSA lock', 'Detachable hanger', 'Silent wheels', 'Trolley strap', 'Reinforced base', 'Antimicrobial material', 'Detachable crossbody bag'],
    weight: ['0.4kg', '0.6kg'],
    color: ['Black', 'Gray', 'Green'],
  },
  headsets: {
    product_subtype: ['Headset', 'Gaming headset', 'Earbuds', 'Conference headset', 'Office headset'],
    connection: ['Wired USB-A', '3.5mm audio', 'USB + 3.5mm audio', '2.4GHz Wireless + Bluetooth 5.2', 'Bluetooth 5.3'],
    connector: ['USB-A', 'USB-C', '3.5mm audio jack'],
    driver_size: ['8mm', '30mm', '50mm'],
    sound: ['Stereo', '7.1 surround'],
    microphone: ['Built-in microphone', 'Detachable microphone', 'Detachable omnidirectional microphone', 'Omnidirectional microphone', 'Flexible boom microphone', 'ENC microphone'],
    frequency_response: ['20Hz-20kHz'],
    impedance: ['21 ohm', '32 ohm'],
    sensitivity: ['105dB', '115dB'],
    battery_life: ['4 hours', '12 hours', '14 hours with case', '240 minutes'],
    charging_time: ['2.5 hours'],
    wireless_range: ['10m'],
    lighting: ['RGB', 'Multicolor RGB'],
    controls: ['Touch controls', 'In-line control', 'USB control box'],
    design: ['In-ear', 'Over-ear', 'Adjustable headband', 'Soft foam ear pads'],
    cable_length: ['1200mm', '1450mm', '2m'],
    weight: ['160g'],
    color: ['Black'],
  },
  keyboards: {
    product_subtype: ['Gaming keyboard'],
    layout: ['80%'],
    switch_type: ['Membrane'],
    numeric_keypad: ['No'],
    anti_ghosting: ['19-key'],
    lighting: ['Three-zone RGB'],
    keystroke_life: ['5 million keystrokes'],
    connection: ['Wired'],
  },
  controllers: {
    product_subtype: ['Gaming controller', 'Mobile gaming controller'],
    connection: ['Bluetooth 5.0', 'USB-C'],
    platform_compatibility: ['Windows', 'Android', 'iPhone 15 series', 'Android 9.0+'],
    vibration: ['Dual vibration motors'],
    sensors: ['Motion sensor'],
    buttons: ['15 buttons'],
    triggers: ['Analog triggers'],
    features: ['Turbo button', 'Interchangeable joysticks', 'Foldable design', 'LED indicators'],
    charging: ['18W fast charging'],
    phone_fit: ['Up to 21.08cm'],
    weight: ['114.8g'],
  },
  docking_stations: {
    product_subtype: ['Docking station', 'Docking stand', 'Laptop stand with hub', 'USB-C dongle'],
    host_connection: ['USB-C'],
    video_outputs: ['HDMI', 'DisplayPort', 'VGA', '2 x HDMI + DP'],
    max_displays: ['3'],
    usb_ports: ['4 x USB-A + 2 x USB-C', '3 x USB-A + USB-C', '3 x USB 3.0'],
    ethernet: ['RJ45', 'Gigabit Ethernet'],
    power_delivery: ['60W', '100W'],
    card_reader: ['SD/TF'],
    audio: ['3.5mm audio'],
    compatibility: ['Chromebook', 'Windows', 'Mac OS', 'Android', 'Linux', 'Chrome'],
    laptop_size: ['11.6"-15.6"'],
    material: ['Aluminum alloy'],
  },
  connectivity: {
    product_subtype: ['5G mobile hotspot', '5G dongle', '5G router', 'Wi-Fi mesh router', 'USB-C dongle'],
    wireless_standard: ['Wi-Fi 6', 'Wi-Fi 6E', 'Wi-Fi 7'],
    cellular: ['5G', '5G SA/NSA'],
    max_speed: ['2.7Gbps', '3.5Gbps', '5Gbps data transfer'],
    users: ['16 devices', '20 devices', '32 devices', '128 devices', '256 concurrent capable'],
    sim_support: ['Nano SIM', 'SIM + eSIM + vSIM', 'vSIM', 'TRI-SIM'],
    ethernet: ['Ethernet', 'WAN', 'RJ45'],
    usb: ['USB-C', 'USB 3.1 Type-C', '2 x USB 3.2 + 2 x USB 2.0'],
    video_outputs: ['2 x HDMI + DP'],
    battery: ['6460mAh', '6500mAh', '8000mAh', 'Up to 28 hours'],
    security: ['WPA3', 'VPN', 'Trend Micro Home Network Security'],
    ruggedness: ['MIL-STD-810H', 'IP54', 'IP68'],
    ports: ['SD/TF', '2 x HDMI', 'DisplayPort', 'RJ45', '3.5mm audio'],
    pack_size: ['Single pack', 'Dual pack', 'Triple pack'],
    qos: ['Hybrid QoS', 'Intel Killer Prioritization Engine'],
  },
  storage: {
    product_subtype: ['External SSD', 'Internal SSD'],
    capacity: ['1TB', '2TB', '4TB'],
    interface: ['USB 3.2 Gen2x2 Type-C', 'PCIe Gen5x4 NVMe'],
    read_speed: ['2000MB/s', '14000MB/s'],
    write_speed: ['2000MB/s', '13000MB/s'],
    form_factor: ['Portable', 'M.2'],
    heatsink: ['Active heatsink + fan'],
    dram_cache: ['2GB', '4GB'],
    endurance: ['1600TBW', '3200TBW'],
    iops: ['2000K / 1600K IOPS'],
    lighting: ['RGB'],
    compatibility: ['Multi-platform'],
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
