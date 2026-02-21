import type { Platform } from './platform'

export type InconsistencyType =
  | 'missing_images'
  | 'different_title'
  | 'different_description'
  | 'missing_categories'
  | 'different_price'
  | 'missing_on_platform'

export interface InconsistencyReport {
  sku: string
  title: string
  type: InconsistencyType
  platforms: Platform[]
  details: string
  suggestedFix?: string
}

export const INCONSISTENCY_LABELS: Record<InconsistencyType, string> = {
  missing_images:       'Images manquantes',
  different_title:      'Titre différent',
  different_description:'Description différente',
  missing_categories:   'Catégories manquantes',
  different_price:      'Prix différent',
  missing_on_platform:  'Absent sur une plateforme',
}
