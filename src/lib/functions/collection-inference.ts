/**
 * Universal collection inference.
 * Maps a product title to one canonical collection slug.
 * Rules are ordered: more specific checks run before generic fallbacks.
 */
export function inferCollection(title: string): string {
  const t = title.toLowerCase()

  // Graphics cards — GPU keywords before any other check
  if (/\bgpu\b|graphics card|\bbifrost\b|\bradeon\b/.test(t)) return 'graphics-cards'

  // Storage
  if (/\bssd\b|\bstorage\b|\bhard drive\b|\bhdd\b/.test(t)) return 'storage'

  // Monitors — foldable/dual before ultrawide before gaming
  if (/\bmonitor\b|\bdisplay\b/.test(t)) {
    if (/foldable|dual.screen|dual.foldable/.test(t)) return 'foldable-monitors'
    if (/ultrawide|ultra.wide|curved/.test(t)) return 'ultrawide-monitors'
    if (/gaming/.test(t)) return 'gaming-monitors'
    return 'monitors'
  }

  // Laptop accessories — must run BEFORE generic laptop match
  if (/\bcarrying case\b|\bprotective case\b|\blaptop case\b/.test(t)) return 'laptop-bags'
  if (/\blaptop stand\b|\bhub\b.*\bstand\b|\bstand\b.*\bhub\b/.test(t)) return 'docking-stations'

  // Laptops — gaming/Predator/Nitro before work signals before generic
  if (/\b(laptop|notebook)\b|\bchromebook\b|\btravelmate\b/.test(t)) {
    if (/grabadora|cd.*dvd|dvd.*cd|optical drive/.test(t)) return 'accessories'
    if (/gaming|\bpredator\b|\bnitro\b/.test(t)) return 'gaming-laptops'
    if (/swift|ultra.thin|ultrabook|\bchromebook\b|\btravelmate\b|\baspire\b/.test(t)) return 'work-laptops'
    return 'laptops'
  }

  // Desktops (all-in-one counts as desktop)
  if (/\bdesktop\b|\btower\b|\bmini.pc\b|\bnuc\b|all.in.one|workstation/.test(t)) return 'desktops'

  // Projectors
  if (/\bprojector\b/.test(t)) return 'projectors'

  // Tablets
  if (/\btablet\b/.test(t)) return 'tablets'

  // Gaming lifestyle — check before generic accessories
  if (/gaming.*(chair|seat)|\brift\b.*(chair|pro)/.test(t)) return 'gaming-chairs'
  if (/gaming.*desk|\brift\b.*desk/.test(t)) return 'gaming-desks'
  if (/\bscooter\b/.test(t)) return 'electric-scooters'
  if (/handheld|gaming console|\bblaze\b/.test(t)) return 'gaming-consoles'

  // Accessories — most specific first
  if (/\bwebcam\b/.test(t)) return 'webcams'
  if (/\bcamera\b|\bspatiallab/.test(t)) return 'cameras'
  if (/soundbar|\bspeaker\b/.test(t)) return 'audio'
  if (/\bgalea\b|\bheadset\b|\bheadphone\b|\bearbuds\b|\bearphones\b/.test(t)) return 'headsets-earbuds'
  if (/\bmouse\b|\bmice\b|\bmousepad/.test(t)) return 'mice'
  if (/\bkeyboard\b/.test(t)) return 'keyboards'
  if (/\bcontroller\b|\bgamepad\b/.test(t)) return 'controllers'
  if (/\bdock\b|\bdocking\b/.test(t)) return 'docking-stations'
  if (/\bbackpack\b|\bsleeve\b|\bluggage\b|\bbag\b|\bfunda\b|\bcarrying case\b|\bprotective case\b|\blaptop case\b/.test(t)) return 'laptop-bags'
  if (/router|\bwi.fi\b|\bwifi\b|\bhotspot\b|\bmesh\b|\bdongle\b/.test(t)) return 'connectivity'

  return 'accessories'
}
