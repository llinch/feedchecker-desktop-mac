import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Info,
  ChevronDown,
  FileText,
  Database,
  Filter,
  MapPin,
  Image,
  Code,
  Copy,
  XCircle,
} from "lucide-react"

export default function Recommendations() {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [checklistItems, setChecklistItems] = useState<Record<string, boolean>>({})

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionId]: !prev[sectionId]
    }))
  }

  const toggleChecklistItem = (itemId: string) => {
    setChecklistItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }))
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <Button variant="ghost" onClick={() => window.history.back()} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Назад
          </Button>
          <div className="text-center">
            <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              Полное руководство по составлению фидов
            </h1>
            <p className="text-muted-foreground text-lg">
              Детальные рекомендации по созданию качественных XML/YML фидов для Diginetica
            </p>
          </div>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="yml" className="w-full">
          <TabsList className="grid w-full grid-cols-5 mb-6">
            <TabsTrigger value="yml" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              YML-фид
            </TabsTrigger>
            <TabsTrigger value="delta" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Дельта-фид
            </TabsTrigger>
            <TabsTrigger value="facet" className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Фасетный фид
            </TabsTrigger>
            <TabsTrigger value="regional" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Региональный фид
            </TabsTrigger>
            <TabsTrigger value="content" className="flex items-center gap-2">
              <Image className="h-4 w-4" />
              Контентный фид
            </TabsTrigger>
          </TabsList>

          {/* YML Feed Tab */}
          <TabsContent value="yml" className="space-y-6">
            {/* Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Компоновка YML-фида
                </CardTitle>
                <CardDescription>
                  Основные требования и рекомендации для создания YML-фида товаров
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                {/* Общие требования */}
                <Collapsible
                  open={expandedSections['yml-general']}
                  onOpenChange={() => toggleSection('yml-general')}
                >
                  <div className="rounded-lg border bg-card">
                    <CollapsibleTrigger className="w-full p-4 hover:bg-accent transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                          <div className="text-left">
                            <p className="font-medium">Общие требования к YML-фиду</p>
                            <p className="text-sm text-muted-foreground">
                              Базовые правила структуры и содержания
                            </p>
                          </div>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            expandedSections['yml-general'] ? "transform rotate-180" : ""
                          }`}
                        />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t p-4 space-y-4 bg-muted/30">
                        <div className="grid md:grid-cols-2 gap-6">
                          <div>
                            <h4 className="font-medium mb-3">Обязательные элементы:</h4>
                            <ul className="text-sm space-y-2 text-muted-foreground">
                              <li className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                Корректная XML структура
                              </li>
                              <li className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                Элемент &lt;shop&gt; с информацией о магазине
                              </li>
                              <li className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                Секция &lt;categories&gt; с категориями
                              </li>
                              <li className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                Секция &lt;offers&gt; с товарами
                              </li>
                              <li className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                Уникальные ID для всех элементов
                              </li>
                            </ul>
                          </div>
                          <div>
                            <h4 className="font-medium mb-3">Рекомендуемые поля:</h4>
                            <ul className="text-sm space-y-2 text-muted-foreground">
                              <li className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">name</Badge>
                                Название товара
                              </li>
                              <li className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">price</Badge>
                                Цена в рублях
                              </li>
                              <li className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">url</Badge>
                                Ссылка на товар
                              </li>
                              <li className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">picture</Badge>
                                Изображения товара
                              </li>
                              <li className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">description</Badge>
                                Описание товара
                              </li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>

                {/* Структура категорий */}
                <Collapsible
                  open={expandedSections['yml-categories']}
                  onOpenChange={() => toggleSection('yml-categories')}
                >
                  <div className="rounded-lg border bg-card">
                    <CollapsibleTrigger className="w-full p-4 hover:bg-accent transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="h-5 w-5 text-orange-600" />
                          <div className="text-left">
                            <p className="font-medium">Структура категорий</p>
                            <p className="text-sm text-muted-foreground">
                              Правила создания иерархии категорий
                            </p>
                          </div>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            expandedSections['yml-categories'] ? "transform rotate-180" : ""
                          }`}
                        />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t p-4 space-y-4 bg-muted/30">
                        <Alert>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>Важные правила категорий</AlertTitle>
                          <AlertDescription>
                            <ul className="list-disc list-inside space-y-1 mt-2">
                              <li>Каждая категория должна иметь уникальный ID</li>
                              <li>Используйте parentId для создания иерархии</li>
                              <li>Избегайте дублирования названий категорий</li>
                              <li>Не создавайте слишком глубокую вложенность (рекомендуется до 5 уровней)</li>
                              <li>Удаляйте пустые категории без товаров</li>
                            </ul>
                          </AlertDescription>
                        </Alert>

                        <div className="space-y-4">
                          <h4 className="font-medium">Пример структуры категорий:</h4>
                          <div className="bg-muted p-4 rounded-lg">
                            <div className="flex items-center gap-2 mb-2">
                              <Code className="h-4 w-4" />
                              <span className="font-medium">XML структура</span>
                              <Button size="sm" variant="ghost" onClick={() => copyToClipboard(`<categories>
  <category id="1">Одежда</category>
  <category id="2" parentId="1">Мужская одежда</category>
  <category id="3" parentId="1">Женская одежда</category>
  <category id="4" parentId="2">Рубашки</category>
  <category id="5" parentId="2">Брюки</category>
</categories>`)}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                            <pre className="text-xs overflow-x-auto">
{`<categories>
  <category id="1">Одежда</category>
  <category id="2" parentId="1">Мужская одежда</category>
  <category id="3" parentId="1">Женская одежда</category>
  <category id="4" parentId="2">Рубашки</category>
  <category id="5" parentId="2">Брюки</category>
</categories>`}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>

                {/* Товары и офферы */}
                <Collapsible
                  open={expandedSections['yml-offers']}
                  onOpenChange={() => toggleSection('yml-offers')}
                >
                  <div className="rounded-lg border bg-card">
                    <CollapsibleTrigger className="w-full p-4 hover:bg-accent transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <BookOpen className="h-5 w-5 text-blue-600" />
                          <div className="text-left">
                            <p className="font-medium">Товары и офферы</p>
                            <p className="text-sm text-muted-foreground">
                              Требования к описанию товаров
                            </p>
                          </div>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            expandedSections['yml-offers'] ? "transform rotate-180" : ""
                          }`}
                        />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t p-4 space-y-4 bg-muted/30">
                        <div className="grid md:grid-cols-2 gap-6">
                          <div>
                            <h4 className="font-medium mb-3">Обязательные поля товара:</h4>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Badge variant="destructive" className="text-xs">ID</Badge>
                                <span className="text-sm">Уникальный идентификатор</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="destructive" className="text-xs">NAME</Badge>
                                <span className="text-sm">Название товара</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="destructive" className="text-xs">PRICE</Badge>
                                <span className="text-sm">Цена в рублях</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="destructive" className="text-xs">URL</Badge>
                                <span className="text-sm">Ссылка на товар</span>
                              </div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-medium mb-3">Рекомендуемые поля:</h4>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">PICTURE</Badge>
                                <span className="text-sm">Изображения товара</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">DESCRIPTION</Badge>
                                <span className="text-sm">Описание товара</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">VENDOR</Badge>
                                <span className="text-sm">Производитель</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-xs">AVAILABLE</Badge>
                                <span className="text-sm">Доступность товара</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h4 className="font-medium">Пример описания товара:</h4>
                          <div className="bg-muted p-4 rounded-lg">
                            <div className="flex items-center gap-2 mb-2">
                              <Code className="h-4 w-4" />
                              <span className="font-medium">XML структура оффера</span>
                              <Button size="sm" variant="ghost" onClick={() => copyToClipboard(`<offer id="12345" available="true">
  <name>Мужская рубашка из хлопка</name>
  <price>2500</price>
  <currencyId>RUR</currencyId>
  <categoryId>4</categoryId>
  <picture>https://example.com/shirt1.jpg</picture>
  <vendor>Brand Name</vendor>
  <description>Качественная мужская рубашка из 100% хлопка</description>
  <url>https://example.com/product/12345</url>
</offer>`)}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                            <pre className="text-xs overflow-x-auto">
{`<offer id="12345" available="true">
  <name>Мужская рубашка из хлопка</name>
  <price>2500</price>
  <currencyId>RUR</currencyId>
  <categoryId>4</categoryId>
  <picture>https://example.com/shirt1.jpg</picture>
  <vendor>Brand Name</vendor>
  <description>Качественная мужская рубашка из 100% хлопка</description>
  <url>https://example.com/product/12345</url>
</offer>`}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>

                {/* Чек-лист для YML */}
                <Collapsible
                  open={expandedSections['yml-checklist']}
                  onOpenChange={() => toggleSection('yml-checklist')}
                >
                  <div className="rounded-lg border bg-card">
                    <CollapsibleTrigger className="w-full p-4 hover:bg-accent transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                          <div className="text-left">
                            <p className="font-medium">Чек-лист проверки YML-фида</p>
                            <p className="text-sm text-muted-foreground">
                              Пошаговая проверка качества фида
                            </p>
                          </div>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${
                            expandedSections['yml-checklist'] ? "transform rotate-180" : ""
                          }`}
                        />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t p-4 space-y-4 bg-muted/30">
                        <div className="space-y-3">
                          {[
                            "XML синтаксис корректен",
                            "Все обязательные поля заполнены",
                            "ID товаров уникальны",
                            "Цены указаны в рублях",
                            "Ссылки на товары работают",
                            "Изображения загружаются",
                            "Категории имеют правильную иерархию",
                            "Нет пустых категорий",
                            "Описания товаров информативны",
                            "Производители указаны корректно"
                          ].map((item, index) => (
                            <div key={index} className="flex items-center space-x-2">
                              <Checkbox 
                                id={`yml-check-${index}`}
                                checked={checklistItems[`yml-check-${index}`] || false}
                                onCheckedChange={() => toggleChecklistItem(`yml-check-${index}`)}
                              />
                              <label htmlFor={`yml-check-${index}`} className="text-sm">
                                {item}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>

              </CardContent>
            </Card>
          </TabsContent>

          {/* Delta Feed Tab */}
          <TabsContent value="delta" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Компоновка дельта-фида
                </CardTitle>
                <CardDescription>
                  Специфика создания дельта-фидов для обновления данных
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Что такое дельта-фид?</AlertTitle>
                  <AlertDescription>
                    Дельта-фид содержит только изменения в данных с момента последнего обновления. 
                    Это позволяет значительно сократить объем передаваемых данных и ускорить обработку.
                  </AlertDescription>
                </Alert>

                <div className="grid md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        Преимущества дельта-фидов
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm space-y-2 text-muted-foreground">
                        <li>• Быстрая обработка изменений</li>
                        <li>• Экономия трафика и ресурсов</li>
                        <li>• Актуальность данных в реальном времени</li>
                        <li>• Снижение нагрузки на сервер</li>
                        <li>• Улучшенная производительность системы</li>
                      </ul>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-orange-600" />
                        Требования к дельта-фиду
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm space-y-2 text-muted-foreground">
                        <li>• Временные метки изменений</li>
                        <li>• Тип операции (добавление/изменение/удаление)</li>
                        <li>• Полная информация об измененных товарах</li>
                        <li>• Корректная последовательность обновлений</li>
                        <li>• Механизм синхронизации состояний</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">Типы операций в дельта-фиде:</h4>
                  <div className="grid md:grid-cols-3 gap-4">
                    <Card className="border-green-200">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs bg-green-100">CREATE</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Добавление новых товаров
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-blue-200">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs bg-blue-100">UPDATE</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Изменение существующих товаров
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-red-200">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs bg-red-100">DELETE</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Удаление товаров
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                </div>

              </CardContent>
            </Card>
          </TabsContent>

          {/* Facet Feed Tab */}
          <TabsContent value="facet" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Filter className="h-5 w-5" />
                  Фасетный фид
                </CardTitle>
                <CardDescription>
                  Создание фидов с фасетной навигацией для улучшения поиска
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Фасетная навигация</AlertTitle>
                  <AlertDescription>
                    Фасетный фид позволяет пользователям фильтровать товары по различным атрибутам 
                    (размер, цвет, материал, бренд и т.д.), что значительно улучшает пользовательский опыт.
                  </AlertDescription>
                </Alert>

                <div className="space-y-4">
                  <h4 className="font-medium">Рекомендуемые фасеты:</h4>
                  <div className="grid md:grid-cols-3 gap-4">
                    <Card className="border-blue-200">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">РАЗМЕР</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Размеры одежды, обуви, мебели
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-blue-200">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">ЦВЕТ</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Цветовая палитра товаров
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-blue-200">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">МАТЕРИАЛ</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Материалы изготовления
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                </div>

              </CardContent>
            </Card>
          </TabsContent>

          {/* Regional Feed Tab */}
          <TabsContent value="regional" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Региональный фид
                </CardTitle>
                <CardDescription>
                  Создание фидов с учетом региональных особенностей
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Региональная специфика</AlertTitle>
                  <AlertDescription>
                    Региональные фиды учитывают особенности доставки, ценообразования 
                    и доступности товаров в различных регионах.
                  </AlertDescription>
                </Alert>

                <div className="grid md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Региональные данные</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm space-y-2 text-muted-foreground">
                        <li>• Регион доставки</li>
                        <li>• Стоимость доставки</li>
                        <li>• Сроки доставки</li>
                        <li>• Наличие товара в регионе</li>
                        <li>• Региональные цены</li>
                      </ul>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Преимущества</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm space-y-2 text-muted-foreground">
                        <li>• Точная информация о доставке</li>
                        <li>• Региональное ценообразование</li>
                        <li>• Улучшенный пользовательский опыт</li>
                        <li>• Снижение отказов от покупки</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>

              </CardContent>
            </Card>
          </TabsContent>

          {/* Content Feed Tab */}
          <TabsContent value="content" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Image className="h-5 w-5" />
                  Контентный фид
                </CardTitle>
                <CardDescription>
                  Создание фидов с богатым контентом для улучшения презентации товаров
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Богатый контент</AlertTitle>
                  <AlertDescription>
                    Контентные фиды включают детальные описания, высококачественные изображения, 
                    видео и другую мультимедийную информацию о товарах.
                  </AlertDescription>
                </Alert>

                <div className="space-y-4">
                  <h4 className="font-medium">Элементы контентного фида:</h4>
                  <div className="grid md:grid-cols-2 gap-4">
                    <Card className="border-green-200">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">ИЗОБРАЖЕНИЯ</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Высококачественные фото товаров (минимум 800x800px)
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-green-200">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">ОПИСАНИЯ</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Детальные описания с характеристиками
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-green-200">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">ВИДЕО</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Видеообзоры и демонстрации товаров
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-green-200">
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">АРТИКУЛЫ</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Артикулы производителя и модели
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                </div>

              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Common Issues Section */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600" />
              Частые ошибки и их решения
            </CardTitle>
            <CardDescription>
              Типичные проблемы при создании фидов и способы их устранения
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="font-medium text-red-600">Критические ошибки:</h4>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li>• Неправильный XML синтаксис</li>
                  <li>• Дублирующиеся ID товаров</li>
                  <li>• Отсутствие обязательных полей</li>
                  <li>• Некорректные ссылки на изображения</li>
                  <li>• Неправильная структура категорий</li>
                </ul>
              </div>
              <div className="space-y-3">
                <h4 className="font-medium text-orange-600">Предупреждения:</h4>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li>• Пустые описания товаров</li>
                  <li>• Низкое качество изображений</li>
                  <li>• Отсутствие информации о бренде</li>
                  <li>• Неактуальные цены</li>
                  <li>• Неинформативные названия категорий</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  )
}