import { useEffect } from "react"
import { Routes, Route } from "react-router-dom"
import { useToast } from "@/hooks/use-toast"
import Home from "./pages/Home"
import Results from "./pages/Results"
import Recommendations from "./pages/Recommendations"
import Logs from "./pages/Logs"

function App() {
  const { toast } = useToast()

  useEffect(() => {
    // Подписка на сообщения от Electron (только в Electron окружении)
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      const electronAPI = (window as any).electronAPI

      // Обработка ошибок бэкенда
      electronAPI.onBackendError((message: string) => {
        toast({
          title: "Ошибка бэкенда",
          description: message,
          variant: "destructive",
          duration: 10000,
        })
      })

      // Обработка информационных сообщений
      electronAPI.onBackendInfo((message: string) => {
        toast({
          title: "Информация",
          description: message,
          duration: 5000,
        })
      })

      // Обработка предупреждений
      electronAPI.onBackendWarning((message: string) => {
        toast({
          title: "Предупреждение",
          description: message,
          variant: "default",
          duration: 8000,
        })
      })

      // Очистка при размонтировании
      return () => {
        electronAPI.removeAllListeners('backend-error')
        electronAPI.removeAllListeners('backend-info')
        electronAPI.removeAllListeners('backend-warning')
      }
    }
  }, [toast])

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/results" element={<Results />} />
      <Route path="/recommendations" element={<Recommendations />} />
      <Route path="/logs" element={<Logs />} />
    </Routes>
  )
}

export default App
