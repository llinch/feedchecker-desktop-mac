import { useState, useEffect } from "react"
import { feedCheckerAPI } from "@/services/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { RefreshCw, Download, Info, AlertCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export default function Logs() {
  const [logs, setLogs] = useState<string[]>([])
  const [logInfo, setLogInfo] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState(100)

  const loadLogs = async () => {
    setLoading(true)
    setError(null)
    try {
      const [logsData, infoData] = await Promise.all([
        feedCheckerAPI.getLogs(lines),
        feedCheckerAPI.getLogsInfo(),
      ])
      setLogs(logsData.lines)
      setLogInfo(infoData)
    } catch (err: any) {
      setError(err.message || "Ошибка при загрузке логов")
      console.error("Error loading logs:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    try {
      await feedCheckerAPI.downloadLogs()
    } catch (err: any) {
      setError(err.message || "Ошибка при скачивании логов")
      console.error("Error downloading logs:", err)
    }
  }

  useEffect(() => {
    loadLogs()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Логи бэкенда</h1>
        <p className="text-muted-foreground">
          Просмотр и скачивание логов сервера для диагностики проблем
        </p>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Ошибка</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {logInfo && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              Информация о логах
            </CardTitle>
          </CardHeader>
          <CardContent>
            {logInfo.exists ? (
              <div className="space-y-2 text-sm">
                <div><strong>Путь к файлу:</strong> {logInfo.log_file_path}</div>
                {logInfo.size_mb !== undefined && (
                  <div><strong>Размер:</strong> {logInfo.size_mb} MB ({logInfo.size_bytes?.toLocaleString() || 0} байт)</div>
                )}
                {logInfo.line_count !== undefined && (
                  <div><strong>Строк в файле:</strong> {logInfo.line_count.toLocaleString()}</div>
                )}
                {logInfo.modified && (
                  <div><strong>Изменен:</strong> {new Date(logInfo.modified).toLocaleString()}</div>
                )}
                {logInfo.created && (
                  <div><strong>Создан:</strong> {new Date(logInfo.created).toLocaleString()}</div>
                )}
              </div>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Файл логов не найден</AlertTitle>
                <AlertDescription>
                  {logInfo.message || "Логирование в файл не настроено или файл не существует"}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Последние строки логов</CardTitle>
              <CardDescription>
                Показываются последние {lines} строк из {logs.length} загруженных
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="flex items-center gap-2">
                <label htmlFor="lines" className="text-sm">Строк:</label>
                <input
                  id="lines"
                  type="number"
                  min="1"
                  max="1000"
                  value={lines}
                  onChange={(e) => setLines(parseInt(e.target.value) || 100)}
                  className="w-20 px-2 py-1 border rounded text-sm"
                />
              </div>
              <Button
                onClick={loadLogs}
                disabled={loading}
                variant="outline"
                size="sm"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Обновить
              </Button>
              <Button
                onClick={handleDownload}
                disabled={loading || !logInfo?.exists}
                variant="outline"
                size="sm"
              >
                <Download className="h-4 w-4 mr-2" />
                Скачать
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Загрузка логов...
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Логи не найдены
            </div>
          ) : (
            <Textarea
              value={logs.join("")}
              readOnly
              className="font-mono text-xs h-[600px] resize-none"
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

