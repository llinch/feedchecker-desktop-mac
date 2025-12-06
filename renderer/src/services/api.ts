import type {
  FeedCheckResult,
  DeltaFeedCheckResult,
  SyntaxCheckResult,
  ProblematicOffersResult,
  ProblemType,
  AsyncJobResponse,
  JobStatusResponse,
  FeedType,
} from "@/types/feed"

// Получаем URL бэкенда из Electron или используем значение по умолчанию
async function getBackendUrl(): Promise<string> {
  // Проверяем, работаем ли мы в Electron
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    try {
      const url = await (window as any).electronAPI.getBackendUrl();
      return url || "http://localhost:8000";
    } catch (error) {
      console.warn("Failed to get backend URL from Electron, using default:", error);
      return "http://localhost:8000";
    }
  }
  // В веб-версии используем переменную окружения или значение по умолчанию
  return import.meta.env.VITE_API_URL ?? "http://localhost:8000";
}

// Кешируем URL бэкенда
let cachedBackendUrl: string | null = null;

/**
 * Вспомогательная функция для детального логирования ошибок в консоль
 */
function logErrorDetails(
  context: string,
  url: string,
  response: Response | null,
  error: any,
  responseText?: string
) {
  const errorDetails = {
    context,
    url,
    timestamp: new Date().toISOString(),
    response: response
      ? {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          ok: response.ok,
        }
      : null,
    responseText: responseText?.substring(0, 1000), // Первые 1000 символов
    error: error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : String(error),
  }

  console.error("🚨 API Error Details:", errorDetails)
  console.error("📋 Full error object:", error)
  
  // Также выводим в удобном формате для копирования
  console.group("🔍 Error Details for Debugging")
  console.log("Context:", context)
  console.log("URL:", url)
  if (response) {
    console.log("Status:", response.status, response.statusText)
    console.log("Headers:", Object.fromEntries(response.headers.entries()))
  }
  if (responseText) {
    console.log("Response Text (first 500 chars):", responseText.substring(0, 500))
  }
  console.log("Error:", error)
  console.groupEnd()
}

export class FeedCheckerAPI {
  private baseUrl: string | null = null

  constructor(baseUrl?: string) {
    if (baseUrl) {
      this.baseUrl = baseUrl;
    }
  }

  // Получаем URL бэкенда (с кешированием)
  private async getBaseUrl(): Promise<string> {
    if (this.baseUrl) {
      return this.baseUrl;
    }
    if (cachedBackendUrl) {
      return cachedBackendUrl;
    }
    cachedBackendUrl = await getBackendUrl();
    return cachedBackendUrl;
  }

  // Вспомогательный метод для получения URL с автоматической подстановкой
  private async url(path: string): Promise<string> {
    const base = await this.getBaseUrl();
    return `${base}${path}`;
  }

  /**
   * Проверка фида (полная проверка)
   */
  async checkFeed(
    siteId: number,
    feedUrl?: string,
    feedFile?: File,
    feedType: FeedType = "xml",
    delimiter: string = ";"
  ): Promise<FeedCheckResult | DeltaFeedCheckResult> {
    const formData = new FormData()
    formData.append("site_id", siteId.toString())
    formData.append("feed_type", feedType)
    
    if (feedType === "delta") {
      formData.append("delimiter", delimiter)
    }

    if (feedUrl) {
      formData.append("feed_url", feedUrl)
    }

    if (feedFile) {
      formData.append("feed_file", feedFile)
    }

    try {
      const response = await fetch(await this.url('/api/check-feed'), {
        method: "POST",
        body: formData,
      })

      // Проверяем статус ответа
      if (!response.ok) {
        let errorData: any = null
        try {
          const contentType = response.headers.get('content-type') || ''
          // Если ответ не JSON, пробуем получить текст
          if (!contentType.includes('application/json')) {
            const text = await response.text()
            console.error("Server returned non-JSON response:", text.substring(0, 500))
            
            // Проверяем, не HTML ли это
            if (text.trim().toLowerCase().startsWith('<!doctype') || text.trim().toLowerCase().startsWith('<html')) {
              logErrorDetails("checkFeed - HTML response (error handler)", `${await this.getBaseUrl()}/api/check-feed`, response, null, text)
              throw new Error("Сервер вернул HTML страницу вместо данных. Возможно, требуется авторизация или URL неверен.")
            }
            
            throw new Error(`Ошибка ${response.status}: ${response.statusText || "Неизвестная ошибка"}. Ответ сервера: ${text.substring(0, 200)}`)
          }
          
          errorData = await response.json()
        } catch (jsonError: any) {
          // Если это уже наша ошибка, пробрасываем дальше
          if (jsonError.message) {
            throw jsonError
          }
          
          // Если не удалось распарсить JSON, пробуем получить текст
          const text = await response.text()
          console.error("Failed to parse error response as JSON:", text.substring(0, 500))
          throw new Error(`Ошибка ${response.status}: ${response.statusText || "Неизвестная ошибка"}`)
        }
        
        // Если это ошибка загрузки (FeedDownloadError)
        // Backend возвращает: { detail: { error_type: "DOWNLOAD_ERROR", ... } }
        const detail = errorData.detail
        if (detail && (detail.error_type === "DOWNLOAD_ERROR" || detail.error_code)) {
          const downloadError = new Error(detail.message || "Ошибка загрузки фида") as any
          downloadError.downloadError = detail
          throw downloadError
        }
        
        // Обычная ошибка
        const errorMessage = typeof detail === 'string' ? detail : 
                            (detail?.message || detail || "Ошибка при проверке фида")
        throw new Error(errorMessage)
      }

      // Проверяем, не HTML ли ответ (502 Bad Gateway обычно возвращает HTML)
      const contentType = response.headers.get("content-type") || ""
      if (!contentType.includes("application/json")) {
        const text = await response.text()
        // Если это HTML, значит прокси вернул страницу ошибки
        if (text.trim().startsWith("<!") || text.trim().startsWith("<html")) {
          throw new Error(
            `Сервер недоступен (502 Bad Gateway). Бэкенд не отвечает. Проверьте логи бэкенда.`
          )
        }
        // Если это не JSON и не HTML, пробуем распарсить как JSON
        try {
          return JSON.parse(text)
        } catch {
          throw new Error(`Сервер вернул неожиданный формат: ${contentType}`)
        }
      }
      
      return response.json()
    } catch (error) {
      logErrorDetails("checkFeed - Exception", await this.url('/api/check-feed'), null, error)
      
      // Обработка сетевых ошибок
      if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
        throw new Error("Не удалось подключиться к серверу. Проверьте, что бэкенд запущен и доступен.")
      }
      
      // Если это уже наша ошибка, пробрасываем дальше
      if (error instanceof Error) {
        throw error
      }
      
      // Неизвестная ошибка
      throw new Error(`Неизвестная ошибка: ${String(error)}`)
    }
  }

  /**
   * Проверка только синтаксиса XML
   */
  async checkSyntax(
    siteId: number,
    feedUrl?: string,
    feedFile?: File
  ): Promise<SyntaxCheckResult> {
    const formData = new FormData()
    formData.append("site_id", siteId.toString())

    if (feedUrl) {
      formData.append("feed_url", feedUrl)
    }

    if (feedFile) {
      formData.append("feed_file", feedFile)
    }

    try {
      const response = await fetch(await this.url('/api/check-syntax'), {
        method: "POST",
        body: formData,
      })

      // Проверяем, не HTML ли ответ
      const contentType = response.headers.get("content-type") || ""
      if (!contentType.includes("application/json")) {
        const text = await response.text()
        if (text.trim().startsWith("<!") || text.trim().startsWith("<html")) {
          logErrorDetails("checkSyntax - HTML response", `${await this.getBaseUrl()}/api/check-syntax`, response, null, text)
          throw new Error("Сервер недоступен (502 Bad Gateway). Бэкенд не отвечает.")
        }
        try {
          return JSON.parse(text)
        } catch {
          logErrorDetails("checkSyntax - Invalid format", `${await this.getBaseUrl()}/api/check-syntax`, response, null, text)
          throw new Error(`Сервер вернул неожиданный формат: ${contentType}`)
        }
      }

      if (!response.ok) {
        try {
          const error = await response.json()
          logErrorDetails("checkSyntax - Error response", `${await this.getBaseUrl()}/api/check-syntax`, response, error)
          throw new Error(error.detail || "Ошибка при проверке синтаксиса")
        } catch (jsonError) {
          const text = await response.clone().text().catch(() => "")
          logErrorDetails("checkSyntax - JSON parse error", `${await this.getBaseUrl()}/api/check-syntax`, response, jsonError, text)
          throw new Error(`Ошибка ${response.status}: ${response.statusText || "Неизвестная ошибка"}`)
        }
      }

      return response.json()
    } catch (error) {
      logErrorDetails("checkSyntax - Exception", `${await this.getBaseUrl()}/api/check-syntax`, null, error)
      if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
        throw new Error("Не удалось подключиться к серверу")
      }
      throw error
    }
  }

  /**
   * Получение списка проблемных товаров
   */
  async getProblematicOffers(
    siteId: number,
    problemType: ProblemType,
    feedUrl?: string,
    feedFile?: File
  ): Promise<ProblematicOffersResult> {
    const formData = new FormData()
    formData.append("site_id", siteId.toString())
    formData.append("problem_type", problemType)

    if (feedUrl) {
      formData.append("feed_url", feedUrl)
    }

    if (feedFile) {
      formData.append("feed_file", feedFile)
    }

    try {
      const response = await fetch(await this.url('/api/get-problematic-offers'), {
        method: "POST",
        body: formData,
      })

      // Проверяем, не HTML ли ответ
      const contentType = response.headers.get("content-type") || ""
      if (!contentType.includes("application/json")) {
        const text = await response.text()
        if (text.trim().startsWith("<!") || text.trim().startsWith("<html")) {
          logErrorDetails("getProblematicOffers - HTML response", `${await this.getBaseUrl()}/api/get-problematic-offers`, response, null, text)
          throw new Error("Сервер недоступен (502 Bad Gateway). Бэкенд не отвечает.")
        }
        try {
          return JSON.parse(text)
        } catch {
          logErrorDetails("getProblematicOffers - Invalid format", `${await this.getBaseUrl()}/api/get-problematic-offers`, response, null, text)
          throw new Error(`Сервер вернул неожиданный формат: ${contentType}`)
        }
      }

      if (!response.ok) {
        try {
          const error = await response.json()
          logErrorDetails("getProblematicOffers - Error response", `${await this.getBaseUrl()}/api/get-problematic-offers`, response, error)
          throw new Error(error.detail || "Ошибка при получении проблемных товаров")
        } catch (jsonError) {
          const text = await response.clone().text().catch(() => "")
          logErrorDetails("getProblematicOffers - JSON parse error", `${await this.getBaseUrl()}/api/get-problematic-offers`, response, jsonError, text)
          throw new Error(`Ошибка ${response.status}: ${response.statusText || "Неизвестная ошибка"}`)
        }
      }

      return response.json()
    } catch (error) {
      logErrorDetails("getProblematicOffers - Exception", `${await this.getBaseUrl()}/api/get-problematic-offers`, null, error)
      if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
        throw new Error("Не удалось подключиться к серверу")
      }
      throw error
    }
  }

  /**
   * Проверка фида с прогрессом (через SSE для URL)
   */
  async checkFeedWithProgress(
    siteId: number,
    feedUrl: string,
    onProgress: (loaded: number, total: number, percentage: number) => void,
    onStatusChange: (status: string) => void
  ): Promise<FeedCheckResult> {
    const baseUrl = await this.getBaseUrl();
    const url = `${baseUrl}/api/check-feed-stream?site_id=${siteId}&feed_url=${encodeURIComponent(feedUrl)}`
    
    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(url)

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          switch (data.type) {
            case 'start':
              onStatusChange(data.message || 'Начинаем загрузку...')
              break

            case 'downloading':
              onStatusChange(data.message || 'Загрузка фида...')
              break

            case 'progress':
              onProgress(data.loaded, data.total, data.percentage)
              break

            case 'processing':
              onStatusChange(data.message || 'Обработка данных...')
              break

            case 'complete':
              eventSource.close()
              resolve(data.result)
              break

            case 'error':
              eventSource.close()
              if (data.error_type === 'download_error') {
                // Детальная ошибка загрузки с полным контекстом
                const downloadError = new Error(data.message) as any
                downloadError.downloadError = {
                  error_type: 'DOWNLOAD_ERROR',
                  error_code: data.error_code,
                  message: data.message,
                  url: data.url,
                  http_status: data.http_status,
                  details: data.details,
                }
                reject(downloadError)
              } else {
                reject(new Error(data.message || 'Ошибка при проверке фида'))
              }
              break
          }
        } catch (e) {
          eventSource.close()
          reject(new Error('Ошибка при обработке ответа сервера'))
        }
      }

      eventSource.onerror = (error) => {
        eventSource.close()
        reject(new Error('Ошибка соединения с сервером'))
      }
    })
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string }> {
    const response = await fetch(await this.url('/health'))
    
    if (!response.ok) {
      throw new Error("API недоступен")
    }

    return response.json()
  }

  /**
   * Экспорт результатов в Excel
   */
  async exportToExcel(
    siteId: number,
    feedUrl?: string,
    feedFile?: File
  ): Promise<Blob> {
    const formData = new FormData()
    formData.append("site_id", siteId.toString())

    if (feedUrl) {
      formData.append("feed_url", feedUrl)
    }

    if (feedFile) {
      formData.append("feed_file", feedFile)
    }

    const response = await fetch(await this.url('/api/export-excel'), {
      method: "POST",
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || "Ошибка при экспорте в Excel")
    }

    return response.blob()
  }

  /**
   * Асинхронная проверка фида (для больших файлов)
   * Создает задачу и возвращает job_id для отслеживания
   */
  async checkFeedAsync(
    siteId: number,
    feedUrl?: string,
    feedFile?: File,
    feedType: FeedType = "xml",
    delimiter: string = ";"
  ): Promise<AsyncJobResponse> {
    const formData = new FormData()
    formData.append("site_id", siteId.toString())
    formData.append("feed_type", feedType)
    
    if (feedType === "delta") {
      formData.append("delimiter", delimiter)
    }

    if (feedUrl) {
      formData.append("feed_url", feedUrl)
    }

    if (feedFile) {
      formData.append("feed_file", feedFile)
    }

    try {
      const response = await fetch(await this.url('/api/check-feed-async'), {
        method: "POST",
        body: formData,
      })

      // Проверяем, не HTML ли ответ (502 Bad Gateway обычно возвращает HTML)
      const contentType = response.headers.get("content-type") || ""
      if (!contentType.includes("application/json")) {
        const text = await response.text()
        // Если это HTML, значит прокси вернул страницу ошибки
        if (text.trim().startsWith("<!") || text.trim().startsWith("<html")) {
          logErrorDetails("checkFeedAsync - HTML response", `${await this.getBaseUrl()}/api/check-feed-async`, response, null, text)
          throw new Error(
            `Сервер недоступен (502 Bad Gateway). Бэкенд не отвечает. Проверьте логи бэкенда.`
          )
        }
        // Если это не JSON и не HTML, пробуем распарсить как JSON
        try {
          return JSON.parse(text)
        } catch {
          logErrorDetails("checkFeedAsync - Invalid format", `${await this.getBaseUrl()}/api/check-feed-async`, response, null, text)
          throw new Error(`Сервер вернул неожиданный формат: ${contentType}`)
        }
      }

      if (!response.ok) {
        try {
          const error = await response.json()
          logErrorDetails("checkFeedAsync - Error response", `${await this.getBaseUrl()}/api/check-feed-async`, response, error)
          throw new Error(error.detail || "Ошибка при создании задачи")
        } catch (jsonError) {
          const text = await response.clone().text().catch(() => "")
          logErrorDetails("checkFeedAsync - JSON parse error", `${await this.getBaseUrl()}/api/check-feed-async`, response, jsonError, text)
          throw new Error(`Ошибка ${response.status}: ${response.statusText || "Неизвестная ошибка"}`)
        }
      }

      return response.json()
    } catch (error) {
      logErrorDetails("checkFeedAsync - Exception", `${await this.getBaseUrl()}/api/check-feed-async`, null, error)
      if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
        throw new Error("Не удалось подключиться к серверу. Проверьте, что бэкенд запущен.")
      }
      throw error
    }
  }

  /**
   * Получение статуса асинхронной задачи
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const baseUrl = await this.getBaseUrl();
    const url = `${baseUrl}/api/job/${jobId}`
    let response: Response | null = null
    
    try {
      // Логируем запрос перед отправкой
      console.log(`📡 getJobStatus - Making request:`, {
        url,
        baseUrl: this.baseUrl,
        jobId,
        timestamp: new Date().toISOString(),
      })
      
      response = await fetch(url)
      
      // Сразу логируем базовую информацию о ответе
      console.log(`📥 getJobStatus - Response received:`, {
        url,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        ok: response.ok,
        contentType: response.headers.get("content-type"),
      })

      // Проверяем, не HTML ли ответ (502 Bad Gateway обычно возвращает HTML)
      const contentType = response.headers.get("content-type") || ""
      if (!contentType.includes("application/json")) {
        const text = await response.text()
        // Если это HTML, значит прокси вернул страницу ошибки
        if (text.trim().startsWith("<!") || text.trim().startsWith("<html")) {
          logErrorDetails("getJobStatus - HTML response", url, response, null, text)
          const error = new Error(
            `Сервер недоступен (502 Bad Gateway). Бэкенд не отвечает. Проверьте логи бэкенда.`
          ) as any
          error.response = response
          error.responseText = text
          throw error
        }
        // Если это не JSON и не HTML, пробуем распарсить как JSON
        try {
          return JSON.parse(text)
        } catch {
          logErrorDetails("getJobStatus - Invalid format", url, response, null, text)
          const error = new Error(`Сервер вернул неожиданный формат: ${contentType}`) as any
          error.response = response
          error.responseText = text
          throw error
        }
      }

      if (!response.ok) {
        if (response.status === 404) {
          logErrorDetails("getJobStatus - 404 Not Found", url, response, null)
          throw new Error("Задача не найдена")
        }
        try {
          const error = await response.json()
          logErrorDetails("getJobStatus - Error response", url, response, error)
          throw new Error(error.detail || "Ошибка при получении статуса задачи")
        } catch (jsonError) {
          // Если не удалось распарсить JSON, возвращаем общую ошибку
          const text = await response.clone().text().catch(() => "")
          logErrorDetails("getJobStatus - JSON parse error", url, response, jsonError, text)
          const error = new Error(`Ошибка ${response.status}: ${response.statusText || "Неизвестная ошибка"}`) as any
          error.response = response
          error.responseText = text
          throw error
        }
      }

      return response.json()
    } catch (error) {
      // Если в error уже есть response, используем его, иначе используем сохраненный response
      const errorResponse = (error as any)?.response || response
      const errorText = (error as any)?.responseText
      
      logErrorDetails("getJobStatus - Exception", url, errorResponse, error, errorText)
      
      if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
        throw new Error("Не удалось подключиться к серверу. Проверьте, что бэкенд запущен.")
      }
      throw error
    }
  }

  /**
   * Удаление задачи (cleanup)
   */
  async deleteJob(jobId: string): Promise<void> {
    try {
      const response = await fetch(await this.url(`/api/job/${jobId}`), {
        method: "DELETE",
      })

      // Проверяем, не HTML ли ответ
      const contentType = response.headers.get("content-type") || ""
      if (!contentType.includes("application/json")) {
        const text = await response.text()
        if (text.trim().startsWith("<!") || text.trim().startsWith("<html")) {
          logErrorDetails("deleteJob - HTML response", `${await this.getBaseUrl()}/api/job/${jobId}`, response, null, text)
          throw new Error("Сервер недоступен (502 Bad Gateway). Бэкенд не отвечает.")
        }
        // Если не JSON и не HTML, просто игнорируем (удаление может не требовать ответа)
        return
      }

      if (!response.ok) {
        try {
          const error = await response.json()
          logErrorDetails("deleteJob - Error response", `${await this.getBaseUrl()}/api/job/${jobId}`, response, error)
          throw new Error(error.detail || "Ошибка при удалении задачи")
        } catch (jsonError) {
          const text = await response.clone().text().catch(() => "")
          logErrorDetails("deleteJob - JSON parse error", `${await this.getBaseUrl()}/api/job/${jobId}`, response, jsonError, text)
          throw new Error(`Ошибка ${response.status}: ${response.statusText || "Неизвестная ошибка"}`)
        }
      }
    } catch (error) {
      logErrorDetails("deleteJob - Exception", `${await this.getBaseUrl()}/api/job/${jobId}`, null, error)
      if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
        throw new Error("Не удалось подключиться к серверу")
      }
      throw error
    }
  }

  /**
   * Проверка фида с polling (обертка для удобства)
   * Автоматически создает задачу и поллит до завершения
   */
  async checkFeedWithPolling(
    siteId: number,
    feedUrl?: string,
    feedFile?: File,
    onProgress?: (progress: number, message: string) => void,
    pollInterval: number = 2000,
    feedType: FeedType = "xml",
    delimiter: string = ";"
  ): Promise<FeedCheckResult | DeltaFeedCheckResult> {
    // Создаем задачу
    const jobResponse = await this.checkFeedAsync(siteId, feedUrl, feedFile, feedType, delimiter)
    const jobId = jobResponse.job_id

    onProgress?.(0, jobResponse.message)

    // Поллим статус
    return new Promise((resolve, reject) => {
      const pollTimer = setInterval(async () => {
        try {
          const status = await this.getJobStatus(jobId)

          onProgress?.(status.progress, status.message)

          if (status.status === "completed" || status.status === "completed_with_errors") {
            clearInterval(pollTimer)

            // Получаем полный результат отдельным запросом
            onProgress?.(100, "Получение результата...")
            try {
              const finalStatus = await fetch(await this.url(`/api/job/${jobId}?include_result=true`))

              // Проверяем, не HTML ли ответ
              const contentType = finalStatus.headers.get("content-type") || ""
              if (!contentType.includes("application/json")) {
                const text = await finalStatus.text()
                if (text.trim().startsWith("<!") || text.trim().startsWith("<html")) {
                  logErrorDetails("checkFeedWithPolling - HTML response (final)", `${await this.getBaseUrl()}/api/job/${jobId}?include_result=true`, finalStatus, null, text)
                  reject(new Error("Сервер недоступен (502 Bad Gateway). Бэкенд не отвечает."))
                  return
                }
                try {
                  const finalData = JSON.parse(text)
                  if (finalData.result) {
                    resolve(finalData.result)
                  } else {
                    logErrorDetails("checkFeedWithPolling - No result in response", `${await this.getBaseUrl()}/api/job/${jobId}?include_result=true`, finalStatus, null, text)
                    reject(new Error("Результат не найден"))
                  }
                  return
                } catch {
                  logErrorDetails("checkFeedWithPolling - Invalid format (final)", `${await this.getBaseUrl()}/api/job/${jobId}?include_result=true`, finalStatus, null, text)
                  reject(new Error(`Сервер вернул неожиданный формат: ${contentType}`))
                  return
                }
              }

              if (!finalStatus.ok) {
                const text = await finalStatus.clone().text().catch(() => "")
                logErrorDetails("checkFeedWithPolling - Not OK (final)", `${await this.getBaseUrl()}/api/job/${jobId}?include_result=true`, finalStatus, null, text)
                reject(new Error("Не удалось получить результат"))
                return
              }

              const finalData = await finalStatus.json()

              if (finalData.result) {
                resolve(finalData.result)
              } else {
                logErrorDetails("checkFeedWithPolling - No result field", `${await this.getBaseUrl()}/api/job/${jobId}?include_result=true`, finalStatus, finalData)
                reject(new Error("Результат не найден"))
              }
            } catch (fetchError) {
              logErrorDetails("checkFeedWithPolling - Exception (final)", `${await this.getBaseUrl()}/api/job/${jobId}?include_result=true`, null, fetchError)
              if (fetchError instanceof TypeError && fetchError.message.includes("Failed to fetch")) {
                reject(new Error("Не удалось подключиться к серверу при получении результата"))
              } else if (fetchError instanceof Error) {
                reject(fetchError)
              } else {
                reject(new Error("Неизвестная ошибка при получении результата"))
              }
            }
          } else if (status.status === "failed") {
            clearInterval(pollTimer)

            // Обрабатываем объект ошибки правильно
            if (status.error && typeof status.error === 'object') {
              // Если это FeedDownloadError с детальной информацией
              if (status.error.error_type === 'download_error') {
                const downloadError = new Error(status.error.message) as any
                downloadError.downloadError = status.error
                reject(downloadError)
              } else {
                // Извлекаем message из объекта ошибки
                const errorMessage = status.error.message || JSON.stringify(status.error)
                reject(new Error(errorMessage))
              }
            } else {
              // Если это строка или undefined
              reject(new Error(status.error || "Ошибка при обработке фида"))
            }
          }
        } catch (error) {
          clearInterval(pollTimer)
          // Пытаемся извлечь response из вложенной ошибки
          const errorResponse = (error as any)?.response || null
          const errorText = (error as any)?.responseText
          logErrorDetails("checkFeedWithPolling - Polling error", `${await this.getBaseUrl()}/api/job/${jobId}`, errorResponse, error, errorText)
          reject(error)
        }
      }, pollInterval)
    })
  }

  /**
   * Получить последние N строк логов бэкенда
   */
  async getLogs(lines: number = 100): Promise<{
    log_file_path: string
    total_lines: number
    returned_lines: number
    lines: string[]
    timestamp: string
  }> {
    try {
      const response = await fetch(await this.url(`/api/logs?lines=${lines}`))
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: "Ошибка при получении логов" }))
        throw new Error(error.detail || "Ошибка при получении логов")
      }
      
      return response.json()
    } catch (error) {
      logErrorDetails("getLogs - Exception", `${await this.getBaseUrl()}/api/logs`, null, error)
      throw error
    }
  }

  /**
   * Получить информацию о файле логов
   */
  async getLogsInfo(): Promise<{
    exists: boolean
    log_file_path: string
    size_bytes?: number
    size_mb?: number
    line_count?: number
    modified?: string
    created?: string
    message?: string
  }> {
    try {
      const response = await fetch(await this.url('/api/logs/info'))
      
      if (!response.ok) {
        throw new Error("Ошибка при получении информации о логах")
      }
      
      return response.json()
    } catch (error) {
      logErrorDetails("getLogsInfo - Exception", `${await this.getBaseUrl()}/api/logs/info`, null, error)
      throw error
    }
  }

  /**
   * Скачать полный файл логов
   */
  async downloadLogs(): Promise<void> {
    try {
      const response = await fetch(await this.url('/api/logs/download'))
      
      if (!response.ok) {
        throw new Error("Ошибка при скачивании логов")
      }
      
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `backend_${new Date().toISOString().replace(/[:.]/g, '-')}.log`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      logErrorDetails("downloadLogs - Exception", `${await this.getBaseUrl()}/api/logs/download`, null, error)
      throw error
    }
  }
}

// Экспорт экземпляра API
export const feedCheckerAPI = new FeedCheckerAPI()


