import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Plus, LayoutDashboard, Settings, Users, FileText } from "lucide-react"

interface SidebarItem {
  id: number
  title: string
  type: string
}

export default function Dashboard() {
  const [items, setItems] = useState<SidebarItem[]>([
    { id: 1, title: "Проект Alpha", type: "project" },
    { id: 2, title: "Задача Beta", type: "task" },
    { id: 3, title: "Документ Gamma", type: "document" },
  ])

  const handleAddItem = () => {
    const newItem: SidebarItem = {
      id: items.length + 1,
      title: `Новый элемент ${items.length + 1}`,
      type: "project",
    }
    setItems([...items, newItem])
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card">
        <div className="flex flex-col h-full">
          {/* Sidebar Header */}
          <div className="p-6">
            <h2 className="text-lg font-semibold">Рабочее пространство</h2>
          </div>
          
          <Separator />
          
          {/* Add Button */}
          <div className="p-4">
            <Button 
              onClick={handleAddItem}
              className="w-full justify-start gap-2"
              variant="default"
            >
              <Plus className="h-4 w-4" />
              Добавить
            </Button>
          </div>

          {/* Items List */}
          <ScrollArea className="flex-1 px-4">
            <div className="space-y-2 pb-4">
              {items.map((item) => (
                <button
                  key={item.id}
                  className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {item.type === "project" && <LayoutDashboard className="h-4 w-4" />}
                    {item.type === "task" && <FileText className="h-4 w-4" />}
                    {item.type === "document" && <FileText className="h-4 w-4" />}
                    <span className="truncate">{item.title}</span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>

          {/* Sidebar Footer */}
          <Separator />
          <div className="p-4 space-y-1">
            <button className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2">
              <Users className="h-4 w-4" />
              Команда
            </button>
            <button className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Настройки
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="border-b bg-card">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <h1 className="text-2xl font-bold">Дашборд</h1>
              <p className="text-sm text-muted-foreground">
                Добро пожаловать в панель управления
              </p>
            </div>
            
            {/* Avatar in Header */}
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium">Иван Петров</p>
                <p className="text-xs text-muted-foreground">ivan@example.com</p>
              </div>
              <Avatar className="h-10 w-10">
                <AvatarImage src="https://github.com/shadcn.png" alt="Аватар" />
                <AvatarFallback>ИП</AvatarFallback>
              </Avatar>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Активные проекты</CardTitle>
                <CardDescription>Текущие задачи в работе</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">12</div>
                <p className="text-xs text-muted-foreground mt-2">
                  +3 за последнюю неделю
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Завершенные задачи</CardTitle>
                <CardDescription>Выполнено в этом месяце</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">47</div>
                <p className="text-xs text-muted-foreground mt-2">
                  +12% по сравнению с прошлым месяцем
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Участники команды</CardTitle>
                <CardDescription>Активные пользователи</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">8</div>
                <p className="text-xs text-muted-foreground mt-2">
                  2 онлайн сейчас
                </p>
              </CardContent>
            </Card>

            <Card className="md:col-span-2 lg:col-span-3">
              <CardHeader>
                <CardTitle>Последние обновления</CardTitle>
                <CardDescription>Активность за последние 24 часа</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>МС</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="text-sm font-medium">Мария Сидорова</p>
                      <p className="text-sm text-muted-foreground">
                        Завершила задачу "Дизайн главной страницы"
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">2 часа назад</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-start gap-4">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>АК</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="text-sm font-medium">Алексей Козлов</p>
                      <p className="text-sm text-muted-foreground">
                        Добавил новый документ в проект Alpha
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">5 часов назад</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-start gap-4">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback>ЕН</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="text-sm font-medium">Елена Новикова</p>
                      <p className="text-sm text-muted-foreground">
                        Создала новую задачу "Интеграция API"
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">8 часов назад</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  )
}
