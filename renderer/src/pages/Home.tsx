import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Switch } from "@/components/ui/switch"
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
  Link as LinkIcon,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  Info,
  Zap,
  Shield,
  Search,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  HelpCircle
} from "lucide-react"
import { feedCheckerAPI } from "@/services/api"
import type { FeedDownloadError } from "@/types/feed"

interface UploadProgress {
  loaded: number
  total: number
  percentage: number
  speed: number // bytes per second
  timeRemaining: number // seconds
}

export default function Home() {
  const navigate = useNavigate()
  const [siteId, setSiteId] = useState<string>("")
  const [feedUrl, setFeedUrl] = useState<string>("")
  const [feedFile, setFeedFile] = useState<File | null>(null)
  const [sourceType, setSourceType] = useState<"url" | "file">("url")
  const [feedType, setFeedType] = useState<"xml" | "delta">("xml")
  const [delimiter, setDelimiter] = useState<string>(";")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<FeedDownloadError | null>(null)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [statusMessage, setStatusMessage] = useState<string>("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [useAsyncMode, setUseAsyncMode] = useState(true)

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const formatSpeed = (bytesPerSecond: number): string => {
    return formatBytes(bytesPerSecond) + '/s'
  }

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return '—'
    if (seconds < 60) return `${Math.round(seconds)}с`
    const minutes = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${minutes}м ${secs}с`
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFeedFile(e.target.files[0])
    }
  }

  // Загрузка с прогрессом через XMLHttpRequest
  const uploadWithProgress = async (file: File, siteId: number, feedType: "xml" | "delta", delimiter: string): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const formData = new FormData()
      formData.append('site_id', siteId.toString())
      formData.append('feed_type', feedType)
      formData.append('feed_file', file)
      
      if (feedType === "delta") {
        formData.append('delimiter', delimiter)
      }

      let startTime = Date.now()
      let startLoaded = 0

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const currentTime = Date.now()
          const timeElapsed = (currentTime - startTime) / 1000 // seconds
          const bytesUploaded = e.loaded - startLoaded

          const speed = timeElapsed > 0 ? bytesUploaded / timeElapsed : 0
          const remainingBytes = e.total - e.loaded
          const timeRemaining = speed > 0 ? remainingBytes / speed : 0

          setUploadProgress({
            loaded: e.loaded,
            total: e.total,
            percentage: Math.round((e.loaded / e.total) * 100),
            speed,
            timeRemaining,
          })

          // Обновляем начальные значения для следующего расчета
          startTime = currentTime
          startLoaded = e.loaded
        }
      })

      xhr.addEventListener('load', () => {
        setUploadProgress(null)
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText)
            resolve(response)
          } catch (error) {
            reject(new Error('Ошибка парсинга ответа сервера'))
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText)
            const detail = errorData.detail
            
            if (detail && detail.error_type === "DOWNLOAD_ERROR") {
              const downloadError = new Error(detail.message) as any
              downloadError.downloadError = detail
              reject(downloadError)
            } else {
              const errorMessage = typeof detail === 'string' ? detail : 
                                  (detail?.message || detail || "Ошибка при проверке фида")
              reject(new Error(errorMessage))
            }
          } catch {
            reject(new Error(`Ошибка ${xhr.status}: ${xhr.statusText}`))
          }
        }
      })

      xhr.addEventListener('error', () => {
        setUploadProgress(null)
        reject(new Error('Ошибка сети при загрузке файла'))
      })

      xhr.addEventListener('abort', () => {
        setUploadProgress(null)
        reject(new Error('Загрузка отменена'))
      })

      const API_BASE_URL = import.meta.env.VITE_API_URL || ""
      xhr.open('POST', `${API_BASE_URL}/api/check-feed`)
      xhr.send(formData)
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setDownloadError(null)

    // Валидация
    if (!siteId || isNaN(Number(siteId))) {
      setError("Введите корректный Site ID")
      return
    }

    // Валидация для обоих типов фидов

    if (sourceType === "url" && !feedUrl) {
      setError("Введите URL фида")
      return
    }

    if (sourceType === "file" && !feedFile) {
      setError("Выберите файл фида")
      return
    }

    setIsLoading(true)
    setUploadProgress(null)
    setStatusMessage("")

    const startTime = Date.now()

    try {
      let result

      // Определяем, использовать ли async mode
      const shouldUseAsync = useAsyncMode || (sourceType === "file" && feedFile && feedFile.size > 50 * 1024 * 1024) // > 50MB

      if (shouldUseAsync) {
        // Используем async job queue с polling
        setStatusMessage("Создание задачи...")
        result = await feedCheckerAPI.checkFeedWithPolling(
          Number(siteId),
          sourceType === "url" ? feedUrl : undefined,
          sourceType === "file" ? feedFile : undefined,
          (progress, message) => {
            setStatusMessage(message)
            // Показываем прогресс как процент от 0 до 100
            setUploadProgress({
              loaded: progress,
              total: 100,
              percentage: progress,
              speed: 0,
              timeRemaining: 0,
            })
          },
          2000, // poll every 2 seconds
          feedType,
          delimiter
        )
      } else if (sourceType === "file" && feedFile) {
        // Для небольших файлов используем загрузку с прогрессом через XMLHttpRequest
        result = await uploadWithProgress(feedFile, Number(siteId), feedType, delimiter)
      } else {
        // Для URL используем SSE с прогрессом
        // Для дельта-фидов используем обычный checkFeed (SSE пока не поддерживается для дельта-фидов)
        if (feedType === "delta") {
          result = await feedCheckerAPI.checkFeed(
            Number(siteId),
            feedUrl,
            undefined,
            feedType,
            delimiter
          )
        } else {
          result = await feedCheckerAPI.checkFeedWithProgress(
          Number(siteId),
          feedUrl,
          (loaded, total, percentage) => {
            // Вычисляем скорость и оставшееся время
            const now = Date.now()
            const elapsed = (now - startTime) / 1000 // seconds
            const speed = elapsed > 0 ? loaded / elapsed : 0
            const remaining = speed > 0 ? (total - loaded) / speed : 0

            setUploadProgress({
              loaded,
              total,
              percentage,
              speed,
              timeRemaining: remaining,
            })
          },
          (status) => {
            setStatusMessage(status)
          }
        )
        }
      }

      // Проверяем ошибки валидации для XML фидов
      if (feedType === "xml") {
        const xmlResult = result as any
        
        // Если есть ошибка валидации (например, некорректные теги param)
        if (xmlResult.validation_error) {
          const errorMessage = xmlResult.message || "Ошибка при проверке XML фида"
          
          // Если есть детали ошибки валидации параметров
          if (xmlResult.param_validation_error && xmlResult.errors) {
            const errors = xmlResult.errors || []
            const errorsCount = xmlResult.errors_count || errors.length
            
            // Формируем детальное сообщение
            let detailedMessage = `${errorMessage}\n\nНайдено ${errorsCount} некорректных тегов <param>:\n\n`
            errors.slice(0, 10).forEach((err: any, idx: number) => {
              detailedMessage += `${idx + 1}. ${err.message || err.error}\n`
              if (err.full_line) {
                detailedMessage += `   Строка: ${err.full_line}\n`
              }
            })
            if (errorsCount > 10) {
              detailedMessage += `\n... и еще ${errorsCount - 10} ошибок`
            }
            
            setDownloadError({
              error_type: "VALIDATION_ERROR",
              error_code: "PARAM_VALIDATION_ERROR",
              message: errorMessage,
              url: sourceType === "url" ? feedUrl : undefined,
              details: {
                param_validation_error: true,
                errors_count: errorsCount,
                errors: errors.slice(0, 20), // Показываем первые 20 ошибок
                suggestion: "Исправьте все теги <param>: каждый тег должен иметь атрибут name с непустым значением. Пример: <param name=\"Цвет\">Красный</param>"
              }
            } as any)
            setError(null)
          } else {
            setError(errorMessage)
            setDownloadError(null)
          }
          return
        }
        
        // Проверяем, не является ли это частичным результатом с критической ошибкой
        // (включая ошибки валидации параметров и дубликаты)
        const syntaxResult = result.syntax
        const hasParamValidationError = syntaxResult && !syntaxResult.valid && (
          syntaxResult.error_code === "PARAM_VALIDATION_ERROR" || 
          syntaxResult.error_code === "PARAM_DUPLICATE_ERROR" ||
          syntaxResult.param_validation_errors ||
          syntaxResult.duplicate_param_errors
        )
        
        // Если есть ошибки валидации параметров, НЕ останавливаемся здесь
        // Продолжаем выполнение, чтобы сохранить результат и перейти на страницу Results,
        // где будут показаны ВСЕ ошибки
        if (syntaxResult && !syntaxResult.valid && hasParamValidationError) {
          // Просто логируем, что есть ошибки валидации параметров
          // Но продолжаем выполнение, чтобы перейти на страницу Results
          console.log('Param validation errors found, will show on Results page')
        } else if (syntaxResult && !syntaxResult.valid && !result.mandatory && !result.categories) {
          // Это критическая ошибка синтаксиса/загрузки (не валидации параметров)
          // Показываем её как ошибку на главной странице
          const errorMessage = syntaxResult.human_message || syntaxResult.message || "Неизвестная ошибка"
          setError(errorMessage)
          setDownloadError(null)
          return
        }
      }

      // Проверяем ошибки валидации для дельта-фидов
      if (feedType === "delta") {
        const deltaResult = result as any
        
        // Если есть ошибка валидации, показываем её на странице
        if (deltaResult.validation_error) {
          const errorMessage = deltaResult.message || "Ошибка при проверке дельта-фида"
          
          // Если есть детали ошибки, показываем их в виде downloadError для единообразия
          if (deltaResult.error_details || deltaResult.parsing?.error_details) {
            const errorDetails = deltaResult.error_details || deltaResult.parsing?.error_details || {}
            setDownloadError({
              error_type: "DOWNLOAD_ERROR",
              error_code: errorDetails.error_type || "VALIDATION_ERROR",
              message: errorMessage,
              url: sourceType === "url" ? feedUrl : undefined,
              details: {
                ...errorDetails,
                parsing_error: true,
                suggestion: errorDetails.suggestion || "Проверьте формат CSV файла и разделитель. Убедитесь, что файл содержит поля: id, price, available."
              }
            } as any)
            setError(null)
          } else {
            setError(errorMessage)
            setDownloadError(null)
          }
          return
        }
        
        // Если нет parsing или summary, это тоже ошибка
        // Проверяем, что это действительно объекты, а не просто truthy значения
        const hasParsing = deltaResult.parsing && typeof deltaResult.parsing === 'object' && !Array.isArray(deltaResult.parsing)
        const hasSummary = deltaResult.summary && typeof deltaResult.summary === 'object' && !Array.isArray(deltaResult.summary)
        
        if (!hasParsing || !hasSummary) {
          const errorMessage = deltaResult.parsing?.error || deltaResult.message || "Не удалось получить результаты проверки дельта-фида"
          
          // Пытаемся извлечь детали ошибки
          if (deltaResult.parsing?.error_details) {
            setDownloadError({
              error_type: "DOWNLOAD_ERROR",
              error_code: "PARSING_ERROR",
              message: errorMessage,
              url: sourceType === "url" ? feedUrl : undefined,
              details: {
                ...deltaResult.parsing.error_details,
                parsing_error: true,
                suggestion: "Проверьте формат CSV файла и разделитель. Убедитесь, что файл содержит поля: id, price, available."
              }
            } as any)
            setError(null)
          } else {
            setError(errorMessage)
            setDownloadError(null)
          }
          return
        }
      }

      // Сохраняем результат в sessionStorage
      // Если результат слишком большой, используем navigation state
      try {
        const resultString = JSON.stringify(result)
        const sourceString = JSON.stringify({
          siteId: Number(siteId),
          feedUrl: sourceType === "url" ? feedUrl : null,
          fileName: sourceType === "file" ? feedFile?.name : null,
          feedType: feedType,
        })
        
        sessionStorage.setItem("feedCheckResult", resultString)
        sessionStorage.setItem("feedSource", sourceString)
        
        // Переходим на страницу результатов
        navigate("/results")
      } catch (storageError: any) {
        // Если не удалось сохранить в sessionStorage (превышен лимит),
        // передаем данные через navigation state
        if (storageError.name === 'QuotaExceededError' || storageError.message?.includes('quota')) {
          console.warn("SessionStorage quota exceeded, using navigation state instead")
          
          // Сохраняем только минимально необходимые данные в sessionStorage
          const minimalResult = {
            site_id: result.site_id,
            feed_type: (result as any).feed_type || feedType,
            // Для XML фидов сохраняем только статистику, без деталей
            ...(feedType === "xml" ? {
              syntax: result.syntax,
              mandatory: result.mandatory ? {
                total_offers: result.mandatory.total_offers,
                valid_offers: result.mandatory.valid_offers,
                problems_count: result.mandatory.problems_count,
                problems_summary: result.mandatory.problems_summary
              } : undefined,
              categories: result.categories,
              // Не сохраняем problematic_offers, category_tree, params_stats, attributes_analysis
              // так как они могут быть очень большими
            } : {
              // Для дельта-фидов сохраняем все, так как они обычно небольшие
              ...result
            })
          }
          
          try {
            sessionStorage.setItem("feedCheckResult", JSON.stringify(minimalResult))
            sessionStorage.setItem("feedSource", JSON.stringify({
              siteId: Number(siteId),
              feedUrl: sourceType === "url" ? feedUrl : null,
              fileName: sourceType === "file" ? feedFile?.name : null,
              feedType: feedType,
            }))
            
            // Передаем полный результат через navigation state
            navigate("/results", { 
              state: { 
                fullResult: result,
                feedSource: {
                  siteId: Number(siteId),
                  feedUrl: sourceType === "url" ? feedUrl : null,
                  fileName: sourceType === "file" ? feedFile?.name : null,
                  feedType: feedType,
                }
              } 
            })
          } catch (secondError) {
            // Если и минимальные данные не помещаются, показываем ошибку
            setError("Результат проверки слишком большой для сохранения. Пожалуйста, используйте экспорт результатов сразу после проверки.")
            setIsLoading(false)
            console.error("Failed to save even minimal result:", secondError)
          }
        } else {
          // Другая ошибка - пробрасываем дальше
          throw storageError
        }
      }
    } catch (err: any) {
      // Проверяем, есть ли детальная информация об ошибке загрузки
      if (err.downloadError) {
        // ОШИБКА ЗАГРУЗКИ - показываем детальную карточку
        setDownloadError(err.downloadError)
        setError(null)
      } else {
        // Обычная ошибка - показываем на странице
        const errorMessage = err instanceof Error ? err.message : "Произошла ошибка при проверке фида"
        setError(errorMessage)
        setDownloadError(null)
      }
    } finally {
      setIsLoading(false)
      setUploadProgress(null)
      setStatusMessage("")
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-600 to-violet-600 rounded-2xl mb-6">
              <Zap className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              FeedChecker
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Профессиональная проверка и валидация XML/YML фидов товаров для Diginetica
            </p>
            
            {/* Quick Actions */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Button 
                variant="outline" 
                onClick={() => navigate("/recommendations")}
                className="flex items-center gap-2 px-6 py-3"
              >
                <BookOpen className="h-5 w-5" />
                Рекомендации по составлению фидов
              </Button>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span>Система работает стабильно</span>
              </div>
            </div>
          </div>

          {/* Main Check Form */}
          <Card className="shadow-2xl border-0 bg-white/80 backdrop-blur-sm">
            <CardHeader className="text-center pb-6">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                  <Search className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-2xl">Новая проверка фида</CardTitle>
                  <CardDescription className="text-base">
                    Введите данные для анализа вашего XML/YML фида
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="px-8 pb-8">
              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Site ID Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="siteId" className="text-base font-semibold">Site ID</Label>
                    <Badge variant="destructive" className="text-xs">Обязательно</Badge>
                  </div>
                  <div className="relative">
                    <Input
                      id="siteId"
                      type="number"
                      placeholder="Например: 12345"
                      value={siteId}
                      onChange={(e) => setSiteId(e.target.value)}
                      disabled={isLoading}
                      className="text-lg h-12 pl-4 pr-12"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <HelpCircle className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <p>Уникальный идентификатор вашего сайта в системе Diginetica. Найти его можно в личном кабинете.</p>
                  </div>
                </div>

                <Separator />

                {/* Feed Type Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-base font-semibold">Тип фида</Label>
                  </div>
                  
                  <Tabs value={feedType} onValueChange={(v) => setFeedType(v as "xml" | "delta")}>
                    <TabsList className="grid w-full grid-cols-2 h-12">
                      <TabsTrigger value="xml" disabled={isLoading} className="flex items-center gap-2 text-base">
                        <FileText className="h-5 w-5" />
                        XML/YML фид
                      </TabsTrigger>
                      <TabsTrigger value="delta" disabled={isLoading} className="flex items-center gap-2 text-base">
                        <FileText className="h-5 w-5" />
                        Дельта-фид (CSV)
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  
                  {feedType === "delta" && (
                    <div className="space-y-2">
                      <Label htmlFor="delimiter">Разделитель CSV</Label>
                      <Input
                        id="delimiter"
                        type="text"
                        placeholder=";"
                        value={delimiter}
                        onChange={(e) => setDelimiter(e.target.value)}
                        disabled={isLoading}
                        maxLength={1}
                        className="w-20"
                      />
                      <p className="text-xs text-muted-foreground">
                        По умолчанию используется точка с запятой (;)
                      </p>
                    </div>
                  )}
                  
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <p>
                      {feedType === "xml" 
                        ? "Обычный XML/YML фид с полной информацией о товарах"
                        : "Дельта-фид содержит только изменения цен и доступности товаров в формате CSV"}
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Feed Source Section */}
                <div className="space-y-6">
                  <div className="flex items-center gap-2">
                    <Label className="text-base font-semibold">Источник фида</Label>
                    <Badge variant="destructive" className="text-xs">Обязательно</Badge>
                  </div>
                  
                  <Tabs value={sourceType} onValueChange={(v) => setSourceType(v as "url" | "file")}>
                    <TabsList className="grid w-full grid-cols-2 h-12">
                      <TabsTrigger value="url" disabled={isLoading} className="flex items-center gap-2 text-base">
                        <LinkIcon className="h-5 w-5" />
                        URL фида
                      </TabsTrigger>
                      <TabsTrigger value="file" disabled={isLoading} className="flex items-center gap-2 text-base">
                        <Upload className="h-5 w-5" />
                        Загрузить файл
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="url" className="mt-6 space-y-4">
                      <div className="relative">
                        <Input
                          type="url"
                          placeholder={feedType === "xml" ? "https://example.com/feed.xml" : "https://example.com/products-delta.csv"}
                          value={feedUrl}
                          onChange={(e) => setFeedUrl(e.target.value)}
                          disabled={isLoading}
                          className="text-lg h-12 pl-4 pr-12"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <LinkIcon className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </div>
                      <div className="flex items-start gap-2 text-sm text-muted-foreground">
                        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <p>
                          {feedType === "xml" 
                            ? "Введите полный URL вашего XML или YML фида. Система автоматически загрузит и проанализирует файл."
                            : "Введите полный URL вашего CSV дельта-фида. Система автоматически загрузит и проанализирует файл."}
                        </p>
                      </div>
                    </TabsContent>

                    <TabsContent value="file" className="mt-6 space-y-4">
                      <div className="border-2 border-dashed border-muted-foreground/25 rounded-xl p-8 text-center hover:border-muted-foreground/50 transition-colors">
                        <div className="flex flex-col items-center gap-4">
                          <div className="w-16 h-16 bg-muted rounded-xl flex items-center justify-center">
                            <Upload className="h-8 w-8 text-muted-foreground" />
                          </div>
                          <div>
                            <Input
                              type="file"
                              accept={feedType === "xml" ? ".xml,.yml" : ".csv"}
                              onChange={handleFileChange}
                              disabled={isLoading}
                              className="cursor-pointer"
                            />
                            <p className="text-sm text-muted-foreground mt-2">
                              {feedType === "xml" 
                                ? "Выберите XML или YML файл с вашего компьютера"
                                : "Выберите CSV файл дельта-фида с вашего компьютера"}
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      {feedFile && (
                        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-xl">
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                          <div className="flex-1">
                            <p className="font-medium text-green-800 dark:text-green-200">{feedFile.name}</p>
                            <p className="text-sm text-green-600 dark:text-green-400">
                              {(feedFile.size / 1024).toFixed(2)} KB
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setFeedFile(null)}
                            className="text-green-600 hover:text-green-700"
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>

                {/* Advanced Options */}
                <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between p-0 h-auto">
                      <span className="text-sm text-muted-foreground">Дополнительные настройки</span>
                      <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 pt-4">
                    <div className="p-4 bg-muted/50 rounded-xl space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-muted-foreground" />
                            <Label htmlFor="async-mode" className="text-sm font-medium cursor-pointer">
                              Async режим (для больших фидов)
                            </Label>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Использовать фоновую обработку без таймаута. Автоматически включается для файлов {">"} 50MB
                          </p>
                        </div>
                        <Switch
                          id="async-mode"
                          checked={useAsyncMode}
                          onCheckedChange={setUseAsyncMode}
                          disabled={isLoading}
                        />
                      </div>

                      <Separator />

                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Таймаут загрузки</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Максимальное время ожидания: 300 секунд (5 минут) для обычного режима, без ограничений в async режиме
                        </p>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {/* Error Display */}
                {downloadError && (
                  <Card className="border-destructive bg-destructive/5">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-5 w-5 text-destructive" />
                          <CardTitle className="text-destructive">
                            {downloadError.error_code === 'CONNECTION_ERROR' && '🔌 Ошибка подключения'}
                            {downloadError.error_code === 'TIMEOUT_ERROR' && '⏱️ Превышено время ожидания'}
                            {downloadError.error_code === 'HTTP_ERROR' && `🌐 Ошибка HTTP ${downloadError.http_status || downloadError.status_code || ''}`}
                            {downloadError.error_code === 'DNS_ERROR' && '🔍 Адрес не найден (DNS)'}
                            {downloadError.error_code === 'SSL_ERROR' && '🔒 Ошибка SSL сертификата'}
                            {(downloadError.error_code === 'VALIDATION_ERROR' || downloadError.error_code === 'PARSING_ERROR') && '❌ Ошибка валидации дельта-фида'}
                            {!['CONNECTION_ERROR', 'TIMEOUT_ERROR', 'HTTP_ERROR', 'DNS_ERROR', 'SSL_ERROR', 'VALIDATION_ERROR', 'PARSING_ERROR'].includes(downloadError.error_code) && '❌ Ошибка загрузки фида'}
                          </CardTitle>
                        </div>
                        <Badge variant="destructive" className="font-mono text-xs">
                          {downloadError.error_code}
                        </Badge>
                      </div>
                      <CardDescription>
                        {downloadError.error_code === 'CONNECTION_ERROR' && 'Не удалось установить соединение с сервером'}
                        {downloadError.error_code === 'TIMEOUT_ERROR' && 'Сервер не ответил в течение 30 секунд'}
                        {downloadError.error_code === 'HTTP_ERROR' && 'Сервер вернул ошибку при запросе фида'}
                        {downloadError.error_code === 'DNS_ERROR' && 'Доменное имя не найдено или не существует'}
                        {downloadError.error_code === 'SSL_ERROR' && 'Проблема с HTTPS сертификатом сервера'}
                        {(downloadError.error_code === 'VALIDATION_ERROR' || downloadError.error_code === 'PARSING_ERROR') && 'Ошибка при проверке или парсинге дельта-фида'}
                        {!['CONNECTION_ERROR', 'TIMEOUT_ERROR', 'HTTP_ERROR', 'DNS_ERROR', 'SSL_ERROR', 'VALIDATION_ERROR', 'PARSING_ERROR'].includes(downloadError.error_code) && 'Фид не был получен с сервера'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Главное сообщение */}
                      <div className="rounded-lg bg-destructive/10 p-4 border border-destructive/20">
                        <p className="font-semibold text-destructive">
                          {downloadError.message}
                        </p>
                      </div>

                      {/* URL и статус код */}
                      {(downloadError.url || downloadError.http_status) && (
                        <div className="space-y-3 text-sm">
                          {downloadError.url && (
                            <div className="space-y-1">
                              <span className="font-medium text-muted-foreground">Проблемный URL:</span>
                              <code className="block bg-muted px-3 py-2 rounded text-xs break-all font-mono">
                                {downloadError.url}
                              </code>
                            </div>
                          )}
                          {downloadError.http_status && (
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-muted-foreground">HTTP статус:</span>
                              <Badge variant={downloadError.http_status >= 500 ? "destructive" : "outline"} className="font-mono">
                                {downloadError.http_status}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {downloadError.http_status === 404 && '(Страница не найдена)'}
                                {downloadError.http_status === 403 && '(Доступ запрещен)'}
                                {downloadError.http_status === 500 && '(Ошибка сервера)'}
                                {downloadError.http_status === 502 && '(Bad Gateway)'}
                                {downloadError.http_status === 503 && '(Сервис недоступен)'}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Рекомендации */}
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Что делать?</AlertTitle>
                        <AlertDescription>
                          <ul className="list-disc list-inside space-y-1 mt-2">
                            {downloadError.error_code === 'CONNECTION_ERROR' && (
                              <>
                                <li>Проверьте правильность написания URL (нет ли опечаток)</li>
                                <li>Убедитесь что сервер работает и доступен</li>
                                <li>Проверьте, что URL начинается с http:// или https://</li>
                                <li>Попробуйте открыть URL в браузере напрямую</li>
                              </>
                            )}
                            {downloadError.error_code === 'TIMEOUT_ERROR' && (
                              <>
                                <li>Подождите несколько минут и попробуйте снова</li>
                                <li>Возможно сервер перегружен или отвечает медленно</li>
                                <li>Проверьте скорость вашего интернет-соединения</li>
                                <li>Свяжитесь с владельцем сервера если проблема повторяется</li>
                              </>
                            )}
                            {downloadError.error_code === 'HTTP_ERROR' && downloadError.http_status === 404 && (
                              <>
                                <li>Файл фида не существует по указанному адресу</li>
                                <li>Проверьте правильность пути к файлу в URL</li>
                                <li>Возможно файл был перемещен или удален</li>
                                <li>Свяжитесь с владельцем сайта для уточнения адреса фида</li>
                              </>
                            )}
                            {downloadError.error_code === 'HTTP_ERROR' && downloadError.http_status === 403 && (
                              <>
                                <li>Доступ к файлу ограничен на сервере</li>
                                <li>Возможно требуется авторизация или IP в whitelist</li>
                                <li>Проверьте настройки доступа к фиду на сервере</li>
                                <li>Свяжитесь с администратором сервера</li>
                              </>
                            )}
                            {downloadError.error_code === 'HTTP_ERROR' && downloadError.http_status >= 500 && (
                              <>
                                <li>На сервере произошла внутренняя ошибка</li>
                                <li>Подождите несколько минут и попробуйте снова</li>
                                <li>Проблема на стороне сервера, не у вас</li>
                                <li>Свяжитесь с владельцем сервера если проблема не исчезает</li>
                              </>
                            )}
                            {downloadError.error_code === 'DNS_ERROR' && (
                              <>
                                <li>Проверьте правильность написания доменного имени</li>
                                <li>Убедитесь что домен существует и зарегистрирован</li>
                                <li>Попробуйте использовать другой DNS сервер</li>
                                <li>Проверьте настройки DNS на сервере если это ваш домен</li>
                              </>
                            )}
                            {downloadError.error_code === 'SSL_ERROR' && (
                              <>
                                <li>SSL сертификат сервера неверный или истек</li>
                                <li>Возможно используется самоподписанный сертификат</li>
                                <li>Проверьте настройки HTTPS на сервере</li>
                                <li>Попробуйте использовать HTTP вместо HTTPS (если возможно)</li>
                              </>
                            )}
                            {(downloadError.error_code === 'VALIDATION_ERROR' || downloadError.error_code === 'PARSING_ERROR') && (
                              <>
                                <li>Проверьте формат CSV файла - он должен содержать разделитель "{delimiter}"</li>
                                <li>Убедитесь, что файл содержит обязательные поля: id, price, available</li>
                                <li>Проверьте, что разделитель указан правильно (по умолчанию точка с запятой ;)</li>
                                <li>Убедитесь, что файл не пустой и содержит данные</li>
                                {downloadError.details?.error_message && (
                                  <li className="font-medium">Детали: {downloadError.details.error_message}</li>
                                )}
                              </>
                            )}
                            {downloadError.details?.suggestion && !(downloadError.error_code === 'VALIDATION_ERROR' || downloadError.error_code === 'PARSING_ERROR') && (
                              <li className="font-medium">{downloadError.details.suggestion}</li>
                            )}
                          </ul>
                        </AlertDescription>
                      </Alert>

                      <Separator />

                      {/* Техническая информация */}
                      {downloadError.details && (
                        <details className="text-sm">
                          <summary className="cursor-pointer font-medium hover:underline">
                            Техническая информация для разработчиков
                          </summary>
                          <div className="mt-3 space-y-2 p-3 bg-muted rounded text-xs">
                            <div>
                              <span className="font-medium">Тип ошибки:</span>{" "}
                              {downloadError.details.error_type}
                            </div>
                            {downloadError.details.technical_message && (
                              <div>
                                <span className="font-medium">Техническое сообщение:</span>
                                <pre className="mt-1 p-2 bg-background rounded overflow-x-auto whitespace-pre-wrap">
                                  {downloadError.details.technical_message}
                                </pre>
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Simple Error Alert */}
                {error && !downloadError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Ошибка</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Upload/Download Progress */}
                {(isLoading || uploadProgress || statusMessage) && (
                  <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                    <CardContent className="pt-6 space-y-4">
                      <div className="flex items-center gap-3">
                        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                        <span className="font-medium text-blue-800 dark:text-blue-200">
                          {statusMessage || (sourceType === "file" ? "Загрузка файла..." : "Загрузка фида...")}
                        </span>
                      </div>
                      
                      {uploadProgress && (
                        <div className="space-y-3">
                          <div className="flex justify-between text-sm">
                            <span className="text-blue-600 dark:text-blue-400">
                              {formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)}
                            </span>
                            <span className="text-blue-600 dark:text-blue-400">
                              {uploadProgress.percentage}%
                            </span>
                          </div>
                          <Progress value={uploadProgress.percentage} className="h-2" />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Скорость: {formatSpeed(uploadProgress.speed)}</span>
                            <span>Осталось: {formatTime(uploadProgress.timeRemaining)}</span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Submit Button */}
                <Button
                  type="submit"
                  size="lg"
                  className="w-full h-14 text-lg font-semibold"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                      Проверка фида...
                    </>
                  ) : (
                    <>
                      <Zap className="mr-3 h-6 w-6" />
                      Запустить проверку
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Feature Cards */}
          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <Card className="group hover:shadow-lg transition-all duration-300 border-0 bg-white/60 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                    <FileText className="h-5 w-5 text-green-600" />
                  </div>
                  <CardTitle className="text-lg">Синтаксис</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Проверка корректности XML структуры, валидация тегов и атрибутов
                </p>
              </CardContent>
            </Card>

            <Card className="group hover:shadow-lg transition-all duration-300 border-0 bg-white/60 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Shield className="h-5 w-5 text-blue-600" />
                  </div>
                  <CardTitle className="text-lg">Обязательные поля</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Валидация наличия ID, цены, категорий и других критически важных данных
                </p>
              </CardContent>
            </Card>

            <Card className="group hover:shadow-lg transition-all duration-300 border-0 bg-white/60 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Search className="h-5 w-5 text-purple-600" />
                  </div>
                  <CardTitle className="text-lg">Категории</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Анализ дерева категорий, поиск дубликатов и проверка иерархии
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

