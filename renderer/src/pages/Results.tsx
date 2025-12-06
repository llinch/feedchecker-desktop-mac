import { useEffect, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  AlertCircle,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Package,
  FolderTree,
  Award,
  AlertTriangle,
  Download,
  Loader2,
  ChevronDown,
  BookOpen,
  GitBranch,
  Hash,
  BarChart3,
  Tag,
} from "lucide-react"
import type { FeedCheckResult, DeltaFeedCheckResult, CategoryNode } from "@/types/feed"
import { PROBLEM_TYPE_LABELS } from "@/types/feed"
import * as XLSX from 'xlsx'

// Компонент для рекурсивного отображения дерева категорий
function CategoryTreeNode({ node, level }: { node: CategoryNode, level: number }) {
  const [isExpanded, setIsExpanded] = useState(node.children.length > 0)
  const hasChildren = node.children.length > 0
  const indent = level * 24

  return (
    <div className="select-none">
      <div 
        className="flex items-center gap-2 py-2 px-3 hover:bg-accent rounded-md transition-colors cursor-pointer"
        style={{ paddingLeft: `${indent + 12}px` }}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
      >
        {hasChildren ? (
          <ChevronDown 
            className={`h-4 w-4 flex-shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} 
          />
        ) : (
          <div className="w-4" />
        )}
        <FolderTree className="h-4 w-4 text-blue-600 flex-shrink-0" />
        <Badge variant="outline" className="font-mono text-xs flex-shrink-0">
          {node.id}
        </Badge>
        <span className="text-sm font-medium">{node.name}</span>
        {hasChildren && (
          <Badge variant="secondary" className="ml-auto text-xs">
            {node.children.length}
          </Badge>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div className="border-l-2 border-muted ml-3">
          {node.children.map((child) => (
            <CategoryTreeNode key={child.id} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// Функция для декодирования HTML-сущностей
function decodeHtmlEntities(text: string): string {
  if (!text) return text
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}

export default function Results() {
  const navigate = useNavigate()
  const location = useLocation()
  const [result, setResult] = useState<FeedCheckResult | DeltaFeedCheckResult | null>(null)
  const [feedSource, setFeedSource] = useState<any>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [expandedProblems, setExpandedProblems] = useState<Record<string, boolean>>({})
  
  // Определяем тип фида - будет использоваться после загрузки данных

  useEffect(() => {
    // Сначала проверяем navigation state (для больших результатов)
    if (location.state?.fullResult) {
      setResult(location.state.fullResult)
      if (location.state.feedSource) {
        setFeedSource(location.state.feedSource)
      }
      return
    }
    
    // Загружаем данные из sessionStorage
    const storedResult = sessionStorage.getItem("feedCheckResult")
    const storedSource = sessionStorage.getItem("feedSource")

    if (!storedResult) {
      navigate("/")
      return
    }

    const parsedResult = JSON.parse(storedResult)
    const parsedSource = storedSource ? JSON.parse(storedSource) : null
    
    setResult(parsedResult)
    if (parsedSource) {
      setFeedSource(parsedSource)
    }
  }, [navigate, location])

  const handleExport = async () => {
    if (!result || !feedSource) return

    setIsExporting(true)
    try {
      // Создаем новую книгу Excel
      const workbook = XLSX.utils.book_new()

      // 1. Лист "Сводка"
      const summaryData = [
        ['FeedChecker - Отчет о проверке фида'],
        [''],
        ['Site ID:', result.site_id],
        ['URL фида:', feedSource.feedUrl || feedSource.fileName || '-'],
        ['Дата проверки:', new Date().toLocaleString('ru-RU')],
        [''],
        ['СТАТИСТИКА'],
        ['Всего товаров:', result.mandatory.total_offers],
        ['Доступных товаров:', result.mandatory.available_offers],
        ['Недоступных товаров:', result.mandatory.unavailable_offers],
        ['Всего категорий:', result.mandatory.total_categories],
        ['Глубина дерева категорий:', result.mandatory.category_tree_depth],
        ['Количество брендов:', result.mandatory.brands_count],
        [''],
        ['ПРОБЛЕМЫ'],
        ['Без ID:', result.mandatory.problems.missing_id],
        ['Без доступности:', result.mandatory.problems.missing_availability],
        ['Без названия:', result.mandatory.problems.missing_name],
        ['Без ссылки:', result.mandatory.problems.missing_link],
        ['Проблемы с ценой:', result.mandatory.problems.price_issues],
        ['Без категории:', result.mandatory.problems.missing_category],
        ['Недействительная категория:', result.mandatory.problems.invalid_category],
        ['Несколько категорий:', result.mandatory.problems.multiple_categories],
        ['Проблемы с брендом:', result.mandatory.problems.vendor_issues],
        ['Без изображения:', result.mandatory.problems.missing_image],
        [''],
        ['КАТЕГОРИИ'],
        ['Пустые категории:', result.categories.empty_categories.length],
        ['Дубликаты категорий:', result.categories.duplicated_categories.length],
        ['Сдвоенные категории:', result.categories.dual_categories.length],
      ]
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Сводка')

      // 2. Листы с проблемными товарами
      Object.entries(result.mandatory.problems).forEach(([key, count]) => {
        if (count > 0) {
          const problemType = key.toUpperCase() as keyof typeof PROBLEM_TYPE_LABELS
          const label = PROBLEM_TYPE_LABELS[problemType] || key
          const offers = result.problematic_offers?.[key as keyof typeof result.problematic_offers] || []

          if (offers.length > 0) {
            const problemData = [
              [label],
              [''],
              ['ID товара', 'Название', 'Бренд', 'Категории', 'Цена', 'URL'],
              ...offers.map(offer => [
                offer.id,
                offer.name,
                offer.vendor,
                offer.categories,
                offer.price,
                offer.url
              ])
            ]
            const problemSheet = XLSX.utils.aoa_to_sheet(problemData)
            // Обрезаем название листа до 31 символа (ограничение Excel)
            const sheetName = label.slice(0, 31)
            XLSX.utils.book_append_sheet(workbook, problemSheet, sheetName)
          }
        }
      })

      // 3. Лист "Дубликаты ID"
      if (result.mandatory.duplicate_ids.length > 0) {
        const duplicatesData = [
          ['Дубликаты ID товаров'],
          [''],
          ['ID товара', 'Количество повторений'],
          ...result.mandatory.duplicate_ids.map(([id, count]) => [id, count])
        ]
        const duplicatesSheet = XLSX.utils.aoa_to_sheet(duplicatesData)
        XLSX.utils.book_append_sheet(workbook, duplicatesSheet, 'Дубликаты ID')
      }

      // 4. Лист "Проблемы категорий"
      if (result.categories.duplicated_categories.length > 0 || result.categories.dual_categories.length > 0) {
        const categoryData = [
          ['Проблемы с категориями'],
          ['']
        ]

        if (result.categories.duplicated_categories.length > 0) {
          categoryData.push(['ДУБЛИКАТЫ КАТЕГОРИЙ'], ['ID категории', 'Название'])
          result.categories.duplicated_categories.forEach(([id, name]) => {
            categoryData.push([id, name])
          })
          categoryData.push([''])
        }

        if (result.categories.dual_categories.length > 0) {
          categoryData.push(['СДВОЕННЫЕ КАТЕГОРИИ'], ['ID категории', 'Название'])
          result.categories.dual_categories.forEach(([id, name]) => {
            categoryData.push([id, name])
          })
        }

        const categorySheet = XLSX.utils.aoa_to_sheet(categoryData)
        XLSX.utils.book_append_sheet(workbook, categorySheet, 'Категории')
      }

      // Генерируем файл Excel и скачиваем
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `feed_check_${feedSource.siteId}_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error("Error exporting:", error)
      alert("Ошибка при экспорте в Excel")
    } finally {
      setIsExporting(false)
    }
  }

  if (!result) {
    return null
  }

  // Определяем тип фида из результата или из feedSource
  // Сначала проверяем feedSource, так как он загружается раньше
  const resultFeedType = feedSource?.feedType || (result as any)?.feed_type || 'xml'
  const isDeltaFeedResult = resultFeedType === 'delta'

  // Проверка на наличие необходимых данных
  // Для дельта-фидов структура другая
  if (isDeltaFeedResult) {
    const deltaResult = result as any
    
    // Проверяем наличие обязательных полей
    // parsing и summary должны быть объектами, а не просто truthy значениями
    const hasParsing = deltaResult.parsing && typeof deltaResult.parsing === 'object' && !Array.isArray(deltaResult.parsing)
    const hasSummary = deltaResult.summary && typeof deltaResult.summary === 'object' && !Array.isArray(deltaResult.summary)
    
    if (!hasParsing || !hasSummary) {
      // Проверяем, есть ли информация об ошибке валидации
      const validationError = (result as any).validation_error
      const errorMessage = (result as any).message || "Не удалось получить полные результаты проверки дельта-фида"
      const errorDetails = (result as any).error_details || (result as any).parsing?.error_details
      
      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
          <div className="container mx-auto px-4 py-8">
            <Card className="max-w-2xl mx-auto border-destructive">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <XCircle className="h-6 w-6 text-destructive" />
                  <CardTitle className="text-destructive">
                    {validationError ? "Ошибка валидации дельта-фида" : "Ошибка получения данных"}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{validationError ? "Ошибка валидации" : "Неполные данные"}</AlertTitle>
                  <AlertDescription>
                    {errorMessage}
                  </AlertDescription>
                </Alert>
                
                {errorDetails && (
                  <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Детали ошибки</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        {errorDetails.error_message && (
                          <div>
                            <span className="font-medium">Сообщение: </span>
                            <span>{errorDetails.error_message}</span>
                          </div>
                        )}
                        {errorDetails.error_type && (
                          <div>
                            <span className="font-medium">Тип ошибки: </span>
                            <Badge variant="outline" className="font-mono text-xs">
                              {errorDetails.error_type}
                            </Badge>
                          </div>
                        )}
                        {errorDetails.parsing_error && (
                          <div className="text-orange-700 dark:text-orange-400">
                            Ошибка при парсинге файла. Проверьте формат CSV и разделитель.
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
                
                {feedSource?.feedUrl && (
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Проверяемый URL:</p>
                    <code className="text-xs break-all">{feedSource.feedUrl}</code>
                  </div>
                )}
                
                <Button onClick={() => navigate("/")} className="w-full">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Вернуться на главную
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )
    }
  } 
  
  // Проверка для XML фидов (не для дельта-фидов)
  const resultFeedTypeForCheck = feedSource?.feedType || (result as any)?.feed_type || 'xml'
  
  // Проверяем ошибки валидации параметров для XML фидов (включая дубликаты)
  const syntaxResult = (result as any)?.syntax
  const hasParamErrors = syntaxResult && !syntaxResult.valid && (
    syntaxResult.error_code === "PARAM_VALIDATION_ERROR" || 
    syntaxResult.error_code === "PARAM_DUPLICATE_ERROR" ||
    syntaxResult.param_validation_errors ||
    syntaxResult.duplicate_param_errors
  )
  
  // Проверяем XML синтаксические ошибки (включая ошибки с амперсандом)
  const hasXmlSyntaxErrors = syntaxResult && !syntaxResult.valid && (
    syntaxResult.error_code === "XML_SYNTAX_ERROR" ||
    syntaxResult.all_errors ||
    (syntaxResult.line && syntaxResult.column)
  )
  
  // Собираем информацию об ошибках для отображения на основной странице результатов
  // Все ошибки (XML синтаксические, валидация параметров и т.д.) будут показаны вместе
  let paramValidationErrors: any[] = []
  let paramErrorsCount = 0
  let isDuplicateError = false
  
  if (resultFeedTypeForCheck !== 'delta' && hasParamErrors) {
    const validationResult = syntaxResult || (result as any)
    
    // Логируем что пришло от бэкенда
    console.log('=== PARAM VALIDATION ERRORS DEBUG ===')
    console.log('validationResult:', validationResult)
    console.log('param_validation_errors:', validationResult.param_validation_errors)
    console.log('duplicate_param_errors:', validationResult.duplicate_param_errors)
    console.log('missing_name_errors:', validationResult.missing_name_errors)
    console.log('errors_count:', validationResult.errors_count)
    console.log('duplicate_count:', validationResult.duplicate_count)
    console.log('missing_name_count:', validationResult.missing_name_count)
    
    // Собираем все ошибки: param_validation_errors содержит ВСЕ ошибки (и missing_name, и duplicates)
    let errors = Array.isArray(validationResult.param_validation_errors) 
      ? validationResult.param_validation_errors 
      : []
    
    const errorsCountFromBackend = validationResult.errors_count || 0
    
    // Если param_validation_errors пуст или содержит меньше ошибок, чем errors_count,
    // собираем из отдельных списков
    if (errors.length === 0 || (errorsCountFromBackend > 0 && errors.length < errorsCountFromBackend)) {
      const duplicateErrors = Array.isArray(validationResult.duplicate_param_errors) 
        ? validationResult.duplicate_param_errors 
        : []
      const missingNameErrors = Array.isArray(validationResult.missing_name_errors) 
        ? validationResult.missing_name_errors 
        : []
      
      // Просто объединяем все ошибки (бэкенд уже убрал дубликаты)
      errors = missingNameErrors.concat(duplicateErrors)
    }
    
    // Используем количество из бэкенда или фактическое количество
    const errorsCount = errorsCountFromBackend > 0 ? errorsCountFromBackend : errors.length
    
    // Убеждаемся, что errors - это массив
    if (!Array.isArray(errors)) {
      console.error('Errors is not an array!', errors)
      errors = []
    }
    
    // Логируем финальный результат
    console.log('=== FINAL ERRORS FOR DISPLAY ===')
    console.log('Final errors array:', errors)
    console.log('Final errors count:', errors.length)
    console.log('Errors count from backend:', errorsCountFromBackend)
    console.log('First error:', errors[0])
    console.log('Last error:', errors[errors.length - 1])
    console.log('All error messages:', errors.map((e: any) => e.message || e.error))
    console.log('=====================================')
    
    // Сохраняем ошибки для отображения на основной странице результатов
    paramValidationErrors = errors
    paramErrorsCount = errorsCount
    isDuplicateError = validationResult.error_code === "PARAM_DUPLICATE_ERROR" || 
                      (validationResult.duplicate_count && validationResult.duplicate_count > 0)
    
    // НЕ делаем return - продолжаем показывать основную страницу результатов со всеми ошибками
    // Все ошибки (XML синтаксические, валидация параметров и т.д.) будут показаны вместе
  }
  
  if (resultFeedTypeForCheck !== 'delta' && (!result.syntax || !result.mandatory || !result.categories)) {
    // Определяем тип ошибки для более понятного сообщения
    const errorMessage = result.syntax?.human_message || result.syntax?.message || ""
    const isUrlError = errorMessage.includes("URL") || 
                       errorMessage.includes("недоступен") || 
                       errorMessage.includes("Ошибка соединения") ||
                       errorMessage.includes("Не удалось подключиться") ||
                       errorMessage.includes("HTTP")
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <div className="container mx-auto px-4 py-8">
          <Card className="max-w-2xl mx-auto border-destructive">
            <CardHeader>
              <div className="flex items-center gap-2">
                <XCircle className="h-6 w-6 text-destructive" />
                <CardTitle className="text-destructive">
                  {isUrlError ? "Ошибка доступа к фиду" : "Ошибка получения данных"}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>
                  {isUrlError ? "Фид недоступен" : "Неполные данные"}
                </AlertTitle>
                <AlertDescription>
                  {isUrlError 
                    ? "Не удалось загрузить фид по указанному URL. Проверьте правильность адреса и доступность сервера."
                    : "Не удалось получить полные результаты проверки. Возможно, фид содержит критические ошибки."
                  }
                </AlertDescription>
              </Alert>
              
              {result.syntax && !result.syntax.valid && (
                <div className="space-y-2">
                  <p className="font-semibold text-sm text-muted-foreground">Детали ошибки:</p>
                  <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
                    <CardContent className="pt-4">
                      <p className="text-sm font-medium mb-2">
                        {result.syntax.human_message || result.syntax.message}
                      </p>
                      {feedSource?.feedUrl && (
                        <div className="mt-3 p-2 rounded bg-background/50">
                          <p className="text-xs text-muted-foreground mb-1">Проверяемый URL:</p>
                          <code className="text-xs break-all">{feedSource.feedUrl}</code>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  
                  {isUrlError && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Рекомендации:</AlertTitle>
                      <AlertDescription className="space-y-1">
                        <li>Проверьте правильность написания URL (опечатки, лишние пробелы)</li>
                        <li>Убедитесь, что сервер доступен и отвечает на запросы</li>
                        <li>Проверьте, что URL начинается с http:// или https://</li>
                        <li>Попробуйте открыть URL в браузере для проверки</li>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
              
              <Button onClick={() => navigate("/")} className="w-full">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Вернуться и проверить URL
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Для дельта-фидов используем другую структуру
  // Используем уже объявленную переменную resultFeedType
  if (isDeltaFeedResult) {
    const deltaResult = result as any
    const hasProblems = Object.values(deltaResult.problems || {}).some((count) => count > 0)
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Button variant="ghost" onClick={() => navigate("/")}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Назад
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold">Результаты проверки дельта-фида</h1>
                <p className="text-muted-foreground mt-1">
                  Site ID: {deltaResult.site_id}
                  {feedSource?.fileName && ` • ${feedSource.fileName}`}
                </p>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Всего строк</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{deltaResult.summary.total_rows}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Доступно</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{deltaResult.summary.available_count}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Недоступно</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{deltaResult.summary.unavailable_count}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Уникальных ID</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{deltaResult.summary.unique_ids_count}</div>
              </CardContent>
            </Card>
          </div>

          {/* Parsing Info */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Информация о парсинге</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Заголовки:</span>
                  <Badge variant={deltaResult.parsing.has_headers ? "default" : "secondary"}>
                    {deltaResult.parsing.has_headers ? "Есть" : "Нет"}
                  </Badge>
                </div>
                {deltaResult.parsing.headers && (
                  <div>
                    <span className="text-muted-foreground">Заголовки: </span>
                    <span className="text-sm">{deltaResult.parsing.headers.join(", ")}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Problems */}
          {hasProblems && (
            <Card className="mb-6 border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Проблемы</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                  {deltaResult.problems.missing_id > 0 && (
                    <div>
                      <Badge variant="destructive">Без ID: {deltaResult.problems.missing_id}</Badge>
                    </div>
                  )}
                  {deltaResult.problems.missing_price > 0 && (
                    <div>
                      <Badge variant="destructive">Без цены: {deltaResult.problems.missing_price}</Badge>
                    </div>
                  )}
                  {deltaResult.problems.invalid_price > 0 && (
                    <div>
                      <Badge variant="destructive">Некорректная цена: {deltaResult.problems.invalid_price}</Badge>
                    </div>
                  )}
                  {deltaResult.problems.missing_available > 0 && (
                    <div>
                      <Badge variant="destructive">Без available: {deltaResult.problems.missing_available}</Badge>
                    </div>
                  )}
                  {deltaResult.problems.duplicate_ids > 0 && (
                    <div>
                      <Badge variant="destructive">Дубликаты ID: {deltaResult.problems.duplicate_ids}</Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Optional Fields */}
          {(deltaResult.optional_fields.rows_with_oldprice > 0 || 
            deltaResult.optional_fields.rows_with_region > 0 || 
            deltaResult.optional_fields.rows_with_attributes > 0) && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Опциональные поля</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {deltaResult.optional_fields.rows_with_oldprice > 0 && (
                    <div>С oldPrice: {deltaResult.optional_fields.rows_with_oldprice}</div>
                  )}
                  {deltaResult.optional_fields.rows_with_region > 0 && (
                    <div>С regionExternalId: {deltaResult.optional_fields.rows_with_region}</div>
                  )}
                  {deltaResult.optional_fields.rows_with_attributes > 0 && (
                    <div>С атрибутами: {deltaResult.optional_fields.rows_with_attributes}</div>
                  )}
                  {deltaResult.optional_fields.attribute_names.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Атрибуты: </span>
                      <span className="text-sm">{deltaResult.optional_fields.attribute_names.join(", ")}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Duplicate IDs Details */}
          {deltaResult.duplicate_ids_details.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Детали дубликатов ID</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {deltaResult.duplicate_ids_details.map((dup, idx) => (
                    <div key={idx} className="border rounded-lg p-4">
                      <div className="font-semibold mb-2">ID {dup.id} встречается {dup.count} раз(а)</div>
                      <div className="space-y-1 text-sm">
                        {dup.rows.map((row, rowIdx) => (
                          <div key={rowIdx} className="text-muted-foreground">
                            Строка {row.row_number}: price={row.price}, available={row.available}
                            {row.regionExternalId && `, region=${row.regionExternalId}`}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {!hasProblems && (
            <Alert className="mb-6 border-green-200 bg-green-50 dark:bg-green-950/20">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800 dark:text-green-400">Дельта-фид корректен</AlertTitle>
              <AlertDescription className="text-green-700 dark:text-green-500">
                Не обнаружено критических проблем в дельта-фиде.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    )
  }

  const hasProblems = Object.values(result.mandatory.problems).some((count) => count > 0)
  const hasCategoryIssues =
    result.categories.empty_categories.length > 0 ||
    result.categories.duplicated_categories.length > 0 ||
    result.categories.dual_categories.length > 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Button variant="ghost" onClick={() => navigate("/")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Назад
            </Button>
            <Button 
              variant="outline" 
              onClick={() => navigate("/recommendations")}
              className="flex items-center gap-2"
            >
              <BookOpen className="h-4 w-4" />
              Рекомендации
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Результаты проверки</h1>
              <p className="text-muted-foreground mt-1">
                Site ID: {result.site_id}
                {feedSource?.feedUrl && ` • ${feedSource.feedUrl}`}
                {feedSource?.fileName && ` • ${feedSource.fileName}`}
              </p>
            </div>
            <div className="text-right">
              <Button onClick={handleExport} disabled={isExporting} size="lg">
                {isExporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Создание файла...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Экспорт в Excel
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                Экспорт из текущих результатов (мгновенно)
              </p>
            </div>
          </div>
        </div>

        {/* Critical Errors - объединенный блок для всех критических ошибок */}
        {(hasXmlSyntaxErrors || hasParamErrors) ? (
          <Card className="mb-6 border-destructive">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-destructive" />
                <CardTitle className="text-destructive">Критические ошибки</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue={hasXmlSyntaxErrors ? "xml-syntax" : "param-validation"} className="w-full">
                <TabsList className="grid w-full" style={{ gridTemplateColumns: `${hasXmlSyntaxErrors && hasParamErrors ? '1fr 1fr' : '1fr'}` }}>
                  {hasXmlSyntaxErrors && (
                    <TabsTrigger value="xml-syntax">
                      XML Синтаксис {result.syntax.errors_count > 0 && `(${result.syntax.errors_count})`}
                    </TabsTrigger>
                  )}
                  {hasParamErrors && (
                    <TabsTrigger value="param-validation">
                      Валидация параметров {paramErrorsCount > 0 && `(${paramErrorsCount})`}
                    </TabsTrigger>
                  )}
                </TabsList>

                {/* XML Syntax Errors Tab */}
                {hasXmlSyntaxErrors && (
                  <TabsContent value="xml-syntax" className="space-y-4 mt-4">
                    <div className="rounded-lg bg-destructive/10 p-4 border border-destructive/20">
                      <div className="font-semibold text-destructive mb-1 whitespace-pre-wrap">
                        {result.syntax.human_message ? (
                          result.syntax.human_message.split('\n').map((line: string, idx: number) => (
                            <div key={idx}>{line}</div>
                          ))
                        ) : (
                          "Ошибка в XML файле"
                        )}
                      </div>
                      {result.syntax.translated_error && (
                        <p className="text-sm text-muted-foreground mt-2">
                          {result.syntax.translated_error}
                        </p>
                      )}
                      {result.syntax.has_ampersand && (
                        <div className="mt-3 rounded bg-yellow-500/10 border border-yellow-500/20 p-2">
                          <p className="text-sm text-yellow-700 dark:text-yellow-400 font-medium">
                            ⚠️ Обнаружен неэкранированный амперсанд (&) - замените на &amp;
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Позиция ошибки */}
                    {(result.syntax.line || result.syntax.column) && (
                      <div className="flex items-center gap-4 text-sm">
                        {result.syntax.line && (
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Строка:</span>
                            <Badge variant="outline">{result.syntax.line}</Badge>
                          </div>
                        )}
                        {result.syntax.column && (
                          <div className="flex items-center gap-2">
                            <span className="font-medium">Позиция:</span>
                            <Badge variant="outline">{result.syntax.column}</Badge>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Строка с ошибкой */}
                    {result.syntax.error_line && (
                      <div>
                        <p className="text-sm font-medium mb-2">Проблемная строка:</p>
                        <div className="rounded bg-muted p-3 font-mono text-sm overflow-x-auto border-l-4 border-destructive">
                          {decodeHtmlEntities(result.syntax.error_line)}
                        </div>
                      </div>
                    )}

                    {/* Полная строка с ошибкой (если есть) - используем display_line если доступен */}
                    {(result.syntax.display_line || result.syntax.full_line) && !result.syntax.error_line && (
                      <div>
                        <p className="text-sm font-medium mb-2">Проблемная строка:</p>
                        <div className="rounded bg-muted p-3 font-mono text-sm overflow-x-auto border-l-4 border-destructive">
                          {decodeHtmlEntities(result.syntax.display_line || result.syntax.full_line || "")}
                        </div>
                        {result.syntax.is_truncated && result.syntax.line_length && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Строка обрезана (полная длина: {result.syntax.line_length} символов)
                          </p>
                        )}
                        {result.syntax.has_ampersand && (
                          <div className="mt-2 rounded bg-yellow-500/10 border border-yellow-500/20 p-2">
                            <p className="text-xs text-yellow-700 dark:text-yellow-400 font-medium">
                              ⚠️ Обнаружен неэкранированный амперсанд (&) - замените на &amp;
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Все XML ошибки (если найдено несколько) */}
                    {result.syntax.all_errors && result.syntax.all_errors.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">
                          Всего найдено XML ошибок: {result.syntax.errors_count || result.syntax.all_errors.length}
                        </p>
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                          {result.syntax.all_errors.map((error: any, idx: number) => (
                            <div key={idx} className="rounded bg-muted p-3 border-l-4 border-destructive">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="destructive">Ошибка {idx + 1}</Badge>
                                {error.line && (
                                  <span className="text-xs text-muted-foreground">
                                    Строка {error.line}, позиция {error.column}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm font-medium mb-1">
                                {error.translated_message || error.message}
                              </p>
                              {(error.display_line || error.full_line) && (
                                <div className="mt-2 rounded bg-background p-2 font-mono text-xs overflow-x-auto">
                                  {decodeHtmlEntities(error.display_line || error.full_line || "")}
                                </div>
                              )}
                              {error.is_truncated && error.line_length && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Строка обрезана (полная длина: {error.line_length} символов)
                                </p>
                              )}
                              {error.has_ampersand && (
                                <div className="mt-2 rounded bg-yellow-500/10 border border-yellow-500/20 p-2">
                                  <p className="text-xs text-yellow-700 dark:text-yellow-400 font-medium">
                                    ⚠️ Обнаружен неэкранированный амперсанд (&) - замените на &amp;
                                  </p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Контекст ошибки */}
                    {result.syntax.context && result.syntax.context.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Контекст:</p>
                        <ScrollArea className="h-[200px] rounded border">
                          <div className="font-mono text-xs">
                            {result.syntax.context.map((line, idx) => (
                              <div
                                key={idx}
                                className={`flex gap-3 px-3 py-1 ${
                                  line.is_error_line
                                    ? "bg-destructive/20 border-l-4 border-destructive font-semibold"
                                    : "hover:bg-muted/50"
                                }`}
                              >
                                <span className="text-muted-foreground select-none w-12 text-right shrink-0">
                                  {line.line_number}
                                </span>
                                <span className="whitespace-pre-wrap break-all">
                                  {line.content || " "}
                                </span>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )}

                    {/* Техническая ошибка (свернутая) */}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Техническая информация
                      </summary>
                      <pre className="mt-2 p-3 rounded bg-muted overflow-x-auto text-xs">
                        {result.syntax.message}
                      </pre>
                    </details>
                  </TabsContent>
                )}

                {/* Param Validation Errors Tab */}
                {hasParamErrors && (
                  <TabsContent value="param-validation" className="space-y-4 mt-4">
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>
                        {isDuplicateError ? "Дубликаты параметров" : "Некорректные теги &lt;param&gt;"}
                      </AlertTitle>
                      <AlertDescription>
                        {isDuplicateError 
                          ? `Обнаружено ${paramErrorsCount} дубликатов параметров с одинаковым именем (игнорируя unit)`
                          : `Обнаружено ${paramErrorsCount} некорректных тегов <param> без атрибута name или с пустым name`}
                      </AlertDescription>
                    </Alert>
                    
                    <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm">Детали ошибок ({paramErrorsCount} всего)</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                          {paramValidationErrors && paramValidationErrors.length > 0 ? (
                            paramValidationErrors.map((error: any, idx: number) => {
                              const uniqueKey = `error-${error.line_number || idx}-${error.param_name || ''}-${error.param_value || ''}-${idx}`
                              return (
                                <div key={uniqueKey} className="p-3 bg-background/50 rounded border border-orange-200 dark:border-orange-800">
                                  <div className="flex items-start gap-2 mb-2">
                                    <Badge variant="outline" className="font-mono text-xs">
                                      Строка {error.line_number || '?'}
                                    </Badge>
                                    <span className="text-sm font-medium text-destructive">
                                      {error.error || error.message}
                                    </span>
                                  </div>
                                  {error.full_line && (
                                    <div className="mt-2 p-2 bg-muted rounded font-mono text-xs overflow-x-auto border-l-2 border-destructive">
                                      {decodeHtmlEntities(error.full_line)}
                                    </div>
                                  )}
                                  {error.all_duplicates && error.all_duplicates.length > 1 && (
                                    <div className="mt-2 space-y-1">
                                      <div className="text-xs font-medium text-muted-foreground">Все дубликаты:</div>
                                      {error.all_duplicates.map((dup: any, dupIdx: number) => (
                                        <div key={dupIdx} className="p-2 bg-muted/50 rounded font-mono text-xs border-l-2 border-orange-400">
                                          {dup.line_number && <span className="text-muted-foreground">Строка {dup.line_number}: </span>}
                                          {decodeHtmlEntities(dup.full_line || '')}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })
                          ) : (
                            <div className="text-sm text-muted-foreground text-center py-2">
                              Ошибки не найдены
                            </div>
                          )}
                          {paramErrorsCount > paramValidationErrors.length && (
                            <div className="text-sm text-muted-foreground text-center py-2">
                              ... и еще {paramErrorsCount - paramValidationErrors.length} ошибок
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Как исправить</AlertTitle>
                      <AlertDescription>
                        {isDuplicateError ? (
                          <>
                            Параметры с одинаковым именем (игнорируя unit) считаются дубликатами и недопустимы.
                            <br />
                            <strong>Неправильно:</strong> 
                            <code className="text-xs block mt-1">
                              &lt;param name="Высота" unit="см"&gt;4&lt;/param&gt;
                              <br />
                              &lt;param name="Высота" unit="м"&gt;4&lt;/param&gt;
                            </code>
                            <br />
                            <strong>Правильно:</strong> Удалите один из дубликатов или используйте разные имена параметров.
                          </>
                        ) : (
                          <>
                            Все теги &lt;param&gt; должны иметь атрибут <code>name</code> с непустым значением.
                            <br />
                            <strong>Неправильно:</strong> <code>&lt;param&gt;0&lt;/param&gt;</code>
                            <br />
                            <strong>Правильно:</strong> <code>&lt;param name="Высота"&gt;4&lt;/param&gt;</code>
                          </>
                        )}
                      </AlertDescription>
                    </Alert>
                  </TabsContent>
                )}
              </Tabs>
            </CardContent>
          </Card>
        ) : result.syntax.valid ? (
          <Alert className="mb-6 border-green-200 bg-green-50 dark:bg-green-950/20">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800 dark:text-green-400">XML синтаксис корректен</AlertTitle>
            <AlertDescription className="text-green-700 dark:text-green-500">
              {result.syntax.human_message || result.syntax.message}
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Старый блок XML ошибок - удаляем, так как теперь он в объединенном блоке выше */}
        {false && result.syntax.valid === false && (
          <Card className="mb-6 border-destructive">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-destructive" />
                <CardTitle className="text-destructive">Ошибка синтаксиса XML</CardTitle>
              </div>
              {result.syntax.error_code && (
                <Badge variant="destructive" className="w-fit mt-2">
                  {result.syntax.error_code}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Понятное описание */}
              <div className="rounded-lg bg-destructive/10 p-4 border border-destructive/20">
                <div className="font-semibold text-destructive mb-1 whitespace-pre-wrap">
                  {result.syntax.human_message ? (
                    result.syntax.human_message.split('\n').map((line: string, idx: number) => (
                      <div key={idx}>{line}</div>
                    ))
                  ) : (
                    "Ошибка в XML файле"
                  )}
                </div>
                {result.syntax.translated_error && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {result.syntax.translated_error}
                  </p>
                )}
                {/* Показываем предупреждение об амперсанде прямо в основном сообщении, если есть */}
                {result.syntax.has_ampersand && (
                  <div className="mt-3 rounded bg-yellow-500/10 border border-yellow-500/20 p-2">
                    <p className="text-sm text-yellow-700 dark:text-yellow-400 font-medium">
                      ⚠️ Обнаружен неэкранированный амперсанд (&) - замените на &amp;
                    </p>
                  </div>
                )}
              </div>

              {/* Позиция ошибки */}
              {(result.syntax.line || result.syntax.column) && (
                <div className="flex items-center gap-4 text-sm">
                  {result.syntax.line && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Строка:</span>
                      <Badge variant="outline">{result.syntax.line}</Badge>
                    </div>
                  )}
                  {result.syntax.column && (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Позиция:</span>
                      <Badge variant="outline">{result.syntax.column}</Badge>
                    </div>
                  )}
                </div>
              )}

              {/* Строка с ошибкой */}
              {result.syntax.error_line && (
                <div>
                  <p className="text-sm font-medium mb-2">Проблемная строка:</p>
                  <div className="rounded bg-muted p-3 font-mono text-sm overflow-x-auto border-l-4 border-destructive">
                    {decodeHtmlEntities(result.syntax.error_line)}
                  </div>
                </div>
              )}

              {/* Полная строка с ошибкой (если есть) - используем display_line если доступен */}
              {(result.syntax.display_line || result.syntax.full_line) && !result.syntax.error_line && (
                <div>
                  <p className="text-sm font-medium mb-2">Проблемная строка:</p>
                  <div className="rounded bg-muted p-3 font-mono text-sm overflow-x-auto border-l-4 border-destructive">
                    {decodeHtmlEntities(result.syntax.display_line || result.syntax.full_line || "")}
                  </div>
                  {result.syntax.is_truncated && result.syntax.line_length && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Строка обрезана (полная длина: {result.syntax.line_length} символов)
                    </p>
                  )}
                  {result.syntax.has_ampersand && (
                    <div className="mt-2 rounded bg-yellow-500/10 border border-yellow-500/20 p-2">
                      <p className="text-xs text-yellow-700 dark:text-yellow-400 font-medium">
                        ⚠️ Обнаружен неэкранированный амперсанд (&) - замените на &amp;
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Все XML ошибки (если найдено несколько) */}
              {result.syntax.all_errors && result.syntax.all_errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">
                    Всего найдено XML ошибок: {result.syntax.errors_count || result.syntax.all_errors.length}
                  </p>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {result.syntax.all_errors.map((error: any, idx: number) => (
                      <div key={idx} className="rounded bg-muted p-3 border-l-4 border-destructive">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="destructive">Ошибка {idx + 1}</Badge>
                          {error.line && (
                            <span className="text-xs text-muted-foreground">
                              Строка {error.line}, позиция {error.column}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium mb-1">
                          {error.translated_message || error.message}
                        </p>
                        {(error.display_line || error.full_line) && (
                          <div className="mt-2 rounded bg-background p-2 font-mono text-xs overflow-x-auto">
                            {decodeHtmlEntities(error.display_line || error.full_line || "")}
                          </div>
                        )}
                        {error.is_truncated && error.line_length && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Строка обрезана (полная длина: {error.line_length} символов)
                          </p>
                        )}
                        {error.has_ampersand && (
                          <div className="mt-2 rounded bg-yellow-500/10 border border-yellow-500/20 p-2">
                            <p className="text-xs text-yellow-700 dark:text-yellow-400 font-medium">
                              ⚠️ Обнаружен неэкранированный амперсанд (&) - замените на &amp;
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Контекст ошибки */}
              {result.syntax.context && result.syntax.context.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Контекст:</p>
                  <ScrollArea className="h-[200px] rounded border">
                    <div className="font-mono text-xs">
                      {result.syntax.context.map((line, idx) => (
                        <div
                          key={idx}
                          className={`flex gap-3 px-3 py-1 ${
                            line.is_error_line
                              ? "bg-destructive/20 border-l-4 border-destructive font-semibold"
                              : "hover:bg-muted/50"
                          }`}
                        >
                          <span className="text-muted-foreground select-none w-12 text-right shrink-0">
                            {line.line_number}
                          </span>
                          <span className="whitespace-pre-wrap break-all">
                            {line.content || " "}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Техническая ошибка (свернутая) */}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Техническая информация
                </summary>
                <pre className="mt-2 p-3 rounded bg-muted overflow-x-auto text-xs">
                  {result.syntax.message}
                </pre>
              </details>
            </CardContent>
          </Card>
        )}

        {/* Statistics Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Всего товаров
                </CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{result.mandatory.total_offers.toLocaleString()}</div>
              <div className="flex gap-2 mt-2 text-xs">
                <span className="text-green-600">
                  ✓ {result.mandatory.available_offers.toLocaleString()} доступных
                </span>
                <span className="text-muted-foreground">
                  / {result.mandatory.unavailable_offers.toLocaleString()} недоступных
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Категорий
                </CardTitle>
                <FolderTree className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{result.mandatory.total_categories.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-2">
                Глубина дерева: {result.mandatory.category_tree_depth} уровней
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Брендов
                </CardTitle>
                <Award className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{result.mandatory.brands_count.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-2">
                Уникальных производителей
              </p>
            </CardContent>
          </Card>

          <Card className={hasProblems ? "border-orange-200 dark:border-orange-900" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Проблем
                </CardTitle>
                <AlertTriangle className={`h-4 w-4 ${hasProblems ? "text-orange-600" : "text-muted-foreground"}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${hasProblems ? "text-orange-600" : "text-green-600"}`}>
                {Object.values(result.mandatory.problems).reduce((a, b) => a + b, 0)}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {hasProblems ? "Требуется внимание" : "Все в порядке"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Results Tabs */}
        <Tabs defaultValue="problems" className="w-full">
          <TabsList className={`grid w-full ${hasParamErrors ? 'grid-cols-7' : 'grid-cols-6'}`}>
            <TabsTrigger value="problems">Проблемы товаров</TabsTrigger>
            <TabsTrigger value="categories">Категории</TabsTrigger>
            <TabsTrigger value="duplicates">Дубликаты</TabsTrigger>
            <TabsTrigger value="tree">Дерево категорий</TabsTrigger>
            <TabsTrigger value="params">Параметры</TabsTrigger>
            {hasParamErrors && (
              <TabsTrigger value="param-errors">
                Ошибки параметров {paramErrorsCount > 0 && `(${paramErrorsCount})`}
              </TabsTrigger>
            )}
            <TabsTrigger value="attributes">Атрибуты</TabsTrigger>
          </TabsList>

          {/* Problems Tab */}
          <TabsContent value="problems" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Проблемные товары</CardTitle>
                <CardDescription>
                  Обнаруженные проблемы с обязательными полями
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px] pr-4">
                  <div className="space-y-3">
                    {Object.entries(result.mandatory.problems).map(([key, count]) => {
                      const problemType = key.toUpperCase() as keyof typeof PROBLEM_TYPE_LABELS
                      const label = PROBLEM_TYPE_LABELS[problemType] || key
                      const problematicOffers = result.problematic_offers?.[key as keyof typeof result.problematic_offers] || []
                      const isExpanded = expandedProblems[key] || false

                      return (
                        <Collapsible
                          key={key}
                          open={isExpanded}
                          onOpenChange={(open) => setExpandedProblems(prev => ({ ...prev, [key]: open }))}
                        >
                          <div className="rounded-lg border bg-card">
                            <CollapsibleTrigger className="w-full p-4 hover:bg-accent transition-colors">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div
                                    className={`h-2 w-2 rounded-full ${
                                      count > 0 ? "bg-orange-500" : "bg-green-500"
                                    }`}
                                  />
                                  <div className="text-left">
                                    <p className="font-medium">{label}</p>
                                    <p className="text-sm text-muted-foreground">
                                      Тип: {problemType}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant={count > 0 ? "destructive" : "secondary"}>
                                    {count} товаров
                                  </Badge>
                                  {count > 0 && (
                                    <ChevronDown
                                      className={`h-4 w-4 transition-transform ${
                                        isExpanded ? "transform rotate-180" : ""
                                      }`}
                                    />
                                  )}
                                </div>
                              </div>
                            </CollapsibleTrigger>

                            {count > 0 && (
                              <CollapsibleContent>
                                <div className="border-t p-4 space-y-3 bg-muted/30">
                                  <p className="text-sm font-medium text-muted-foreground">
                                    Список проблемных товаров:
                                  </p>
                                  <ScrollArea className="h-[300px]">
                                    <div className="space-y-2">
                                      {problematicOffers.length > 0 ? (
                                        problematicOffers.map((offer, idx) => (
                                          <div
                                            key={idx}
                                            className="p-3 rounded-md border bg-card space-y-1 text-sm"
                                          >
                                            <div className="flex justify-between items-start">
                                              <div className="space-y-1 flex-1">
                                                <div className="flex items-center gap-2">
                                                  <span className="font-medium">ID:</span>
                                                  <span className="text-muted-foreground">{offer.id}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <span className="font-medium">Название:</span>
                                                  <span className="text-muted-foreground">{offer.name}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <span className="font-medium">Бренд:</span>
                                                  <span className="text-muted-foreground">{offer.vendor}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <span className="font-medium">Категории:</span>
                                                  <span className="text-muted-foreground">{offer.categories}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <span className="font-medium">Цена:</span>
                                                  <span className="text-muted-foreground">{offer.price}</span>
                                                </div>
                                              </div>
                                            </div>
                                            {offer.url && offer.url !== 'Ссылка отсутствует' && (
                                              <a
                                                href={offer.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-blue-600 hover:underline block mt-2"
                                              >
                                                Открыть карточку товара →
                                              </a>
                                            )}
                                          </div>
                                        ))
                                      ) : (
                                        <p className="text-sm text-muted-foreground p-3">
                                          Детальная информация о товарах недоступна
                                        </p>
                                      )}
                                    </div>
                                  </ScrollArea>
                                </div>
                              </CollapsibleContent>
                            )}
                          </div>
                        </Collapsible>
                      )
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Categories Tab */}
          <TabsContent value="categories" className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Пустые категории</CardTitle>
                  <CardDescription className="text-xs">
                    Не привязаны к товарам
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-muted-foreground">
                    {result.categories.empty_categories.length}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Не влияют на поиск
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Дубликаты</CardTitle>
                  <CardDescription className="text-xs">
                    Одинаковые названия
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600">
                    {result.categories.duplicated_categories.length}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Влияют на подсказки
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Сдвоенные</CardTitle>
                  <CardDescription className="text-xs">
                    С несколькими словами
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600">
                    {result.categories.dual_categories.length}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Влияют на отбор кандидатов
                  </p>
                </CardContent>
              </Card>
            </div>

            {hasCategoryIssues && (
              <Card>
                <CardHeader>
                  <CardTitle>Детали проблемных категорий</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-4">
                      {result.categories.duplicated_categories.length > 0 && (
                        <div>
                          <h3 className="font-medium mb-2">Дубликаты категорий:</h3>
                          <div className="space-y-1">
                            {result.categories.duplicated_categories.slice(0, 20).map(([id, name], idx) => (
                              <div key={idx} className="text-sm p-2 rounded bg-muted">
                                <span className="font-mono text-xs text-muted-foreground">ID: {id}</span>
                                {" • "}
                                <span>{name}</span>
                              </div>
                            ))}
                          </div>
                          {result.categories.duplicated_categories.length > 20 && (
                            <p className="text-sm text-muted-foreground mt-2">
                              И еще {result.categories.duplicated_categories.length - 20}...
                            </p>
                          )}
                        </div>
                      )}

                      {result.categories.dual_categories.length > 0 && (
                        <>
                          <Separator />
                          <div>
                            <h3 className="font-medium mb-2">Сдвоенные категории:</h3>
                            <div className="space-y-1">
                              {result.categories.dual_categories.slice(0, 20).map(([id, name], idx) => (
                                <div key={idx} className="text-sm p-2 rounded bg-muted">
                                  <span className="font-mono text-xs text-muted-foreground">ID: {id}</span>
                                  {" • "}
                                  <span>{name}</span>
                                </div>
                              ))}
                            </div>
                            {result.categories.dual_categories.length > 20 && (
                              <p className="text-sm text-muted-foreground mt-2">
                                И еще {result.categories.dual_categories.length - 20}...
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Duplicates Tab */}
          <TabsContent value="duplicates" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Дубликаты ID товаров</CardTitle>
                <CardDescription>
                  Товары с одинаковыми идентификаторами
                </CardDescription>
              </CardHeader>
              <CardContent>
                {result.mandatory.duplicate_ids.length > 0 ? (
                  <ScrollArea className="h-[400px] pr-4">
                    <div className="space-y-2">
                      {result.mandatory.duplicate_ids.map(([id, count], idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 rounded-lg border bg-card"
                        >
                          <div>
                            <p className="font-mono text-sm font-medium">{id}</p>
                            <p className="text-xs text-muted-foreground">ID товара</p>
                          </div>
                          <Badge variant="destructive">
                            {count} повторений
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-8">
                    <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-2" />
                    <p className="text-lg font-medium">Дубликатов не обнаружено</p>
                    <p className="text-sm text-muted-foreground">
                      Все ID товаров уникальны
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Category Tree Tab */}
          <TabsContent value="tree" className="space-y-4">
            {result.category_tree && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-blue-600" />
                    <CardTitle>Визуальная структура категорий</CardTitle>
                  </div>
                  <CardDescription>
                    Иерархическое дерево категорий фида
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {result.category_tree.orphaned_categories.length > 0 && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Найдены категории с несуществующими родителями!</AlertTitle>
                      <AlertDescription>
                        Обнаружено {result.category_tree.orphaned_categories.length} категорий с родителями, которых нет в дереве
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="mb-4 flex items-center justify-between">
                    <Badge variant="outline">
                      Всего категорий: {result.category_tree.total_categories}
                    </Badge>
                    <Badge variant="secondary">
                      Корневых категорий: {result.category_tree.tree.length}
                    </Badge>
                  </div>

                  <ScrollArea className="h-[600px] w-full rounded-md border p-4">
                    {result.category_tree.tree.length > 0 ? (
                      <div className="space-y-2">
                        {result.category_tree.tree.map((category) => (
                          <CategoryTreeNode key={category.id} node={category} level={0} />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        Нет категорий в фиде
                      </div>
                    )}
                  </ScrollArea>

                  {result.category_tree.orphaned_categories.length > 0 && (
                    <>
                      <Separator className="my-6" />
                      <div>
                        <h3 className="font-semibold text-destructive mb-3 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          Категории с несуществующими родителями ({result.category_tree.orphaned_categories.length})
                        </h3>
                        <div className="space-y-2">
                          {result.category_tree.orphaned_categories.map((cat) => (
                            <div key={cat.id} className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="destructive" className="font-mono text-xs">
                                  ID: {cat.id}
                                </Badge>
                                <span className="font-medium">{cat.name}</span>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                Родительский ID <span className="font-mono">{cat.missing_parent_id}</span> не найден в фиде
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Parameters Tab */}
          <TabsContent value="params" className="space-y-4">
            {result.params_stats && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Hash className="h-5 w-5 text-purple-600" />
                    <CardTitle>Статистика параметров товаров</CardTitle>
                  </div>
                  <CardDescription>
                    Анализ использования параметров (param) в фиде
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {result.params_stats.has_no_params_warning && result.params_stats.offers_without_params === result.params_stats.total_offers && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>В фиде нет параметров!</AlertTitle>
                      <AlertDescription>
                        Ни один товар не содержит тегов &lt;param&gt;. Это значительно снижает качество фида и возможности фильтрации товаров.
                      </AlertDescription>
                    </Alert>
                  )}

                  {result.params_stats.has_no_params_warning && result.params_stats.offers_without_params > 0 && result.params_stats.offers_without_params < result.params_stats.total_offers && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Часть товаров без параметров</AlertTitle>
                      <AlertDescription>
                        {result.params_stats.offers_without_params} товаров ({Math.round((result.params_stats.offers_without_params / result.params_stats.total_offers) * 100)}%) не имеют параметров
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                          <BarChart3 className="h-8 w-8 text-blue-600" />
                          <Badge variant="secondary" className="text-lg">
                            {result.params_stats.avg_params_per_offer}
                          </Badge>
                        </div>
                        <h3 className="font-semibold">Среднее на товар</h3>
                        <p className="text-sm text-muted-foreground">
                          параметров на один offer
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                          <CheckCircle2 className="h-8 w-8 text-green-600" />
                          <Badge variant="secondary" className="text-lg">
                            {result.params_stats.offers_with_params}
                          </Badge>
                        </div>
                        <h3 className="font-semibold">С параметрами</h3>
                        <p className="text-sm text-muted-foreground">
                          товаров имеют param
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                          <XCircle className="h-8 w-8 text-orange-600" />
                          <Badge variant="secondary" className="text-lg">
                            {result.params_stats.offers_without_params}
                          </Badge>
                        </div>
                        <h3 className="font-semibold">Без параметров</h3>
                        <p className="text-sm text-muted-foreground">
                          товаров без param
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="border-purple-200 bg-purple-50 dark:bg-purple-950/20">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                          <Hash className="h-8 w-8 text-purple-600" />
                          <Badge variant="secondary" className="text-lg">
                            {result.params_stats.total_params}
                          </Badge>
                        </div>
                        <h3 className="font-semibold">Всего параметров</h3>
                        <p className="text-sm text-muted-foreground">
                          в фиде
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="p-4 bg-muted/50 rounded-lg">
                    <h3 className="font-semibold mb-2">Рекомендации:</h3>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      <li>• Оптимально: 5-15 параметров на товар</li>
                      <li>• Минимум: 3-5 ключевых параметров (размер, цвет, материал и т.д.)</li>
                      <li>• Параметры улучшают фильтрацию и поиск товаров</li>
                      <li>• Используйте стандартные названия параметров</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Старая вкладка param-errors удалена - теперь ошибки параметров показываются в объединенном блоке "Критические ошибки" сверху */}

          {/* Attributes Tab */}
          <TabsContent value="attributes" className="space-y-4">
            {result.attributes_analysis && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Tag className="h-5 w-5 text-indigo-600" />
                    <CardTitle>Анализ атрибутов и значений</CardTitle>
                  </div>
                  <CardDescription>
                    Все атрибуты фида с анализом их значений
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {result.attributes_analysis.params.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                        <Hash className="h-5 w-5" />
                        Параметры товаров (param/name)
                        <Badge variant="secondary">{result.attributes_analysis.total_param_types} типов</Badge>
                      </h3>
                      <ScrollArea className="h-[500px] w-full rounded-md border p-4">
                        <div className="space-y-4">
                          {result.attributes_analysis.params.map((param, idx) => (
                            <Collapsible key={idx}>
                              <div className="p-4 bg-muted/30 rounded-lg">
                                <CollapsibleTrigger className="w-full">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <ChevronDown className="h-4 w-4" />
                                      <span className="font-medium">{param.name}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline">{param.total_count} использований</Badge>
                                      <Badge variant="secondary">{param.unique_values_count} уникальных</Badge>
                                    </div>
                                  </div>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="mt-3">
                                  <Separator className="mb-3" />
                                  <div className="space-y-2">
                                    <p className="text-sm font-medium text-muted-foreground">Топ-10 значений:</p>
                                    {param.top_values.map((val, vidx) => (
                                      <div key={vidx} className="flex items-center justify-between p-2 bg-background rounded">
                                        <span className="text-sm">{val.value || <span className="text-muted-foreground italic">(пусто)</span>}</span>
                                        <Badge variant="outline" className="text-xs">{val.count}</Badge>
                                      </div>
                                    ))}
                                  </div>
                                </CollapsibleContent>
                              </div>
                            </Collapsible>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  {result.attributes_analysis.offer_tags.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                          <Tag className="h-5 w-5" />
                          Теги товаров (offer)
                          <Badge variant="secondary">{result.attributes_analysis.total_offer_tag_types} типов</Badge>
                        </h3>
                        <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                          <div className="space-y-4">
                            {result.attributes_analysis.offer_tags.map((tag, idx) => (
                              <Collapsible key={idx}>
                                <div className="p-4 bg-muted/30 rounded-lg">
                                  <CollapsibleTrigger className="w-full">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <ChevronDown className="h-4 w-4" />
                                        <span className="font-medium font-mono text-sm">&lt;{tag.name}&gt;</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Badge variant="outline">{tag.total_count} использований</Badge>
                                        <Badge variant="secondary">{tag.unique_values_count} уникальных</Badge>
                                      </div>
                                    </div>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent className="mt-3">
                                    <Separator className="mb-3" />
                                    <div className="space-y-2">
                                      <p className="text-sm font-medium text-muted-foreground">Топ-10 значений:</p>
                                      {tag.top_values.map((val, vidx) => (
                                        <div key={vidx} className="flex items-center justify-between p-2 bg-background rounded">
                                          <span className="text-sm">{val.value}</span>
                                          <Badge variant="outline" className="text-xs">{val.count}</Badge>
                                        </div>
                                      ))}
                                    </div>
                                  </CollapsibleContent>
                                </div>
                              </Collapsible>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

