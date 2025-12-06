// Типы для работы с FeedChecker API

export interface ErrorContextLine {
  line_number: number
  content: string
  is_error_line: boolean
}

// Ошибка ЗАГРУЗКИ фида (фид не был получен)
export interface FeedDownloadError {
  error_type: "DOWNLOAD_ERROR"
  error_code: string
  message: string
  url?: string
  status_code?: number
  details?: {
    error_type: string
    technical_message: string
    suggestion: string
    [key: string]: any
  }
  help?: string
  timestamp?: string
}

// Ошибка ВАЛИДАЦИИ фида (фид получен, но содержит ошибки)
export interface SyntaxCheckResult {
  valid: boolean
  message: string
  human_message?: string
  error_code?: string
  line?: number
  column?: number
  error_text?: string
  translated_error?: string
  error_line?: string
  context?: ErrorContextLine[]
}

export interface MandatoryCheckResult {
  total_offers: number
  available_offers: number
  unavailable_offers: number
  total_categories: number
  category_tree_depth: number
  brands_count: number
  problems: {
    missing_id: number
    missing_availability: number
    missing_name: number
    missing_link: number
    price_issues: number
    missing_category: number
    invalid_category: number
    multiple_categories: number
    vendor_issues: number
    missing_image: number
  }
  duplicate_ids: Array<[string, number]>
}

export interface CategoryIssues {
  empty_categories: Array<[string, string]>
  duplicated_categories: Array<[string, string]>
  dual_categories: Array<[string, string]>
}

export interface CategoryNode {
  id: string
  name: string
  parent_id: string
  children: CategoryNode[]
}

export interface OrphanedCategory {
  id: string
  name: string
  missing_parent_id: string
}

export interface CategoryTree {
  tree: CategoryNode[]
  orphaned_categories: OrphanedCategory[]
  total_categories: number
}

export interface ParamsStats {
  total_params: number
  total_offers: number
  avg_params_per_offer: number
  offers_with_params: number
  offers_without_params: number
  has_no_params_warning: boolean
}

export interface AttributeValue {
  value: string
  count: number
}

export interface AttributeInfo {
  name: string
  total_count: number
  unique_values_count: number
  top_values: AttributeValue[]
}

export interface AttributesAnalysis {
  params: AttributeInfo[]
  offer_tags: AttributeInfo[]
  total_param_types: number
  total_offer_tag_types: number
}

export interface FeedCheckResult {
  site_id: number
  syntax: SyntaxCheckResult
  mandatory: MandatoryCheckResult
  problematic_offers: ProblematicOffersMap
  categories: CategoryIssues
  category_tree?: CategoryTree
  params_stats?: ParamsStats
  attributes_analysis?: AttributesAnalysis
}

export interface OfferDetail {
  id: string
  name: string
  url: string
  price: string
  vendor: string
  categories: string
}

export interface ProblematicOffersMap {
  missing_id: OfferDetail[]
  missing_availability: OfferDetail[]
  missing_name: OfferDetail[]
  missing_link: OfferDetail[]
  price_issues: OfferDetail[]
  missing_category: OfferDetail[]
  invalid_category: OfferDetail[]
  multiple_categories: OfferDetail[]
  vendor_issues: OfferDetail[]
  missing_image: OfferDetail[]
}

export interface ProblematicOffersResult {
  problem_type: string
  count: number
  offers: OfferDetail[]
}

export type ProblemType =
  | "MISSING_ID"
  | "MISSING_AVAILABLE"
  | "MISSING_NAME"
  | "MISSING_LINK"
  | "PRICE_ISSUES"
  | "MISSING_CATEGORY"
  | "INVALID_CATEGORY"
  | "MULTIPLE_CATEGORIES"
  | "MISSING_VENDOR"
  | "MISSING_IMAGE"

export const PROBLEM_TYPE_LABELS: Record<ProblemType, string> = {
  MISSING_ID: "Без ID",
  MISSING_AVAILABLE: "Без информации о доступности",
  MISSING_NAME: "Без названия",
  MISSING_LINK: "Без ссылки",
  PRICE_ISSUES: "Проблемы с ценой",
  MISSING_CATEGORY: "Без категории",
  INVALID_CATEGORY: "Недействительная категория",
  MULTIPLE_CATEGORIES: "Несколько категорий без тега",
  MISSING_VENDOR: "Проблемы с брендом",
  MISSING_IMAGE: "Без изображения",
}

// Async Job Queue types
export type JobStatus = "pending" | "processing" | "completed" | "completed_with_errors" | "failed"

export interface AsyncJobResponse {
  job_id: string
  status: JobStatus
  message: string
  poll_url: string
  created_at: string
}

export interface JobStatusResponse {
  job_id: string
  site_id: number
  status: JobStatus
  progress: number
  message: string
  created_at: string
  completed_at?: string
  result?: FeedCheckResult | DeltaFeedCheckResult
  error?: string
}

// Типы для дельта-фидов
export interface DeltaFeedCheckResult {
  site_id: number
  feed_type: "delta"
  parsing: {
    total_rows: number
    has_headers: boolean
    headers?: string[] | null
  }
  summary: {
    total_rows: number
    available_count: number
    unavailable_count: number
    unique_ids_count: number
  }
  problems: {
    missing_id: number
    missing_price: number
    invalid_price: number
    missing_available: number
    duplicate_ids: number
  }
  optional_fields: {
    rows_with_oldprice: number
    rows_with_region: number
    rows_with_attributes: number
    attribute_names: string[]
  }
  duplicate_ids_details: Array<{
    id: string
    count: number
    rows: Array<{
      row_number: number
      price: string
      available: string
      regionExternalId?: string
    }>
  }>
}

export type FeedType = "xml" | "delta"

