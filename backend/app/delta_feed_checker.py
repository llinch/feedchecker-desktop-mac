"""
Модуль для проверки дельта-фидов (CSV формат)
Дельта-фиды содержат информацию о товарах с измененной ценой или доступностью
"""
import csv
import io
import logging
import requests
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Any
from enum import Enum

from app.exceptions import FeedDownloadError, FeedValidationError

# Логирование уже настроено в main.py, просто получаем logger
logger = logging.getLogger(__name__)


class DeltaProblemType(Enum):
    """Типы проблем в дельта-фидах"""
    MISSING_ID = "без ID или с пустым ID"
    MISSING_PRICE = "без цены или с пустой ценой"
    INVALID_PRICE = "с некорректной ценой (ноль, отрицательная, не число)"
    MISSING_AVAILABLE = "без флага доступности"
    DUPLICATE_ID = "дубликаты ID"


class DeltaFeedChecker:
    """
    Класс для проверки дельта-фидов
    
    Поддерживает:
    - Дельта-фиды с заголовками и без
    - Настраиваемый разделитель (по умолчанию ;)
    - Обязательные поля: id, price, available
    - Опциональные поля: oldPrice, regionExternalId, атрибуты
    """
    
    # Стандартные имена полей (регистр важен для заголовков)
    REQUIRED_FIELDS = ['id', 'price', 'available']
    OPTIONAL_FIELDS = ['oldPrice', 'regionExternalId']
    
    def __init__(
        self,
        site_id: int,
        file_content: bytes = None,
        site_url: str = None,
        delimiter: str = ';',
        available_true_values: List[str] = None,
        attribute_delimiter: str = ',',
        filename: str = None
    ):
        """
        Инициализация DeltaFeedChecker
        
        Args:
            site_id: ID сайта
            file_content: Содержимое файла в байтах
            site_url: URL фида (пока не поддерживается)
            delimiter: Разделитель CSV (по умолчанию ;)
            available_true_values: Значения, которые считаются "в наличии" (по умолчанию ['1', 'true', 'True', 'TRUE'])
            attribute_delimiter: Разделитель для множественных значений атрибутов (по умолчанию ,)
        """
        self.site_id = site_id
        self.file_content = file_content
        self.site_url = site_url
        self.delimiter = delimiter
        self.attribute_delimiter = attribute_delimiter
        self.filename = filename
        
        # Headers для HTTP запросов
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/csv, application/csv, */*; q=0.01',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0',
        }
        
        # Значения, которые считаются "в наличии"
        if available_true_values is None:
            self.available_true_values = ['1', 'true', 'True', 'TRUE']
        else:
            self.available_true_values = available_true_values
        
        # Результаты парсинга
        self.rows = []
        self.csv_headers = []  # Заголовки CSV файла (не путать с self.headers для HTTP)
        self.has_headers = False
        
        # Статистика
        self.total_rows = 0
        self.available_count = 0
        self.unavailable_count = 0
        self.unique_ids = set()
        
        # Проблемы
        self.problems = {
            'missing_id': [],
            'missing_price': [],
            'invalid_price': [],
            'missing_available': [],
            'duplicate_ids': []
        }
        
        # Опциональные поля
        self.rows_with_oldprice = 0
        self.rows_with_region = 0
        self.rows_with_attributes = 0
        self.attribute_names = set()
        
        # Детали дубликатов
        self.duplicate_ids_details = []
        
        # Ошибки парсинга
        self.parse_errors = []
    
    def _validate_file_format(self, content: str, response_headers: dict = None) -> None:
        """
        Проверка формата файла - должен быть CSV
        
        Args:
            content: Содержимое файла
            response_headers: HTTP заголовки ответа (если загрузка по URL)
        
        Raises:
            FeedValidationError: Если формат файла не CSV
        """
        # Безопасная проверка типа response_headers
        if response_headers is not None and not isinstance(response_headers, dict):
            logger.warning(f"⚠️ response_headers не является словарем, тип: {type(response_headers)}, значение: {response_headers}")
            response_headers = {}
        # Проверяем расширение файла в URL
        if self.site_url:
            url_lower = self.site_url.lower()
            # Проверяем расширение в URL - если явно указан не-CSV формат, выдаем ошибку
            non_csv_extensions = ['.xml', '.json', '.html', '.htm', '.xls', '.xlsx', '.txt']
            url_has_non_csv_ext = any(url_lower.endswith(ext) or f'{ext}?' in url_lower for ext in non_csv_extensions)
            
            if url_has_non_csv_ext:
                # Определяем какой формат обнаружен
                detected_ext = next((ext for ext in non_csv_extensions if url_lower.endswith(ext) or f'{ext}?' in url_lower), 'неизвестный')
                raise FeedValidationError(
                    message="Некорректный формат файла дельта-фида",
                    validation_results={
                        "format_error": True,
                        "error_message": f"URL указывает на файл формата {detected_ext.upper()}, ожидается CSV формат",
                        "url": self.site_url,
                        "detected_format": detected_ext.upper().replace('.', '')
                    }
                )
            
            # Если расширение не .csv, проверяем Content-Type заголовок
            if not (url_lower.endswith('.csv') or '.csv?' in url_lower):
                if response_headers and isinstance(response_headers, dict):
                    content_type = response_headers.get('Content-Type', '').lower()
                    if content_type and 'csv' not in content_type and 'text/plain' not in content_type:
                        # Если Content-Type явно указывает на другой формат
                        if 'xml' in content_type or 'json' in content_type or 'html' in content_type:
                            raise FeedValidationError(
                                message="Некорректный формат файла дельта-фида",
                                validation_results={
                                    "format_error": True,
                                    "error_message": f"Ожидается CSV файл, получен {content_type}",
                                    "url": self.site_url
                                }
                            )
        
        # Проверяем имя файла (если загружен файл)
        if self.filename:
            filename_lower = self.filename.lower()
            if not filename_lower.endswith('.csv'):
                raise FeedValidationError(
                    message="Некорректный формат файла дельта-фида",
                    validation_results={
                        "format_error": True,
                        "error_message": f"Ожидается CSV файл, получен файл с расширением {filename_lower.split('.')[-1] if '.' in filename_lower else 'без расширения'}",
                        "filename": self.filename
                    }
                )
        
        # Проверяем начало содержимого на явные признаки других форматов
        content_start = content.strip()[:200].lower()
        
        # Проверка на XML
        if content_start.startswith('<?xml') or content_start.startswith('<'):
            raise FeedValidationError(
                message="Некорректный формат файла дельта-фида",
                validation_results={
                    "format_error": True,
                    "error_message": "Файл содержит XML разметку, ожидается CSV формат",
                    "detected_format": "XML"
                }
            )
        
        # Проверка на JSON
        if content_start.startswith('{') or content_start.startswith('['):
            try:
                import json
                json.loads(content[:1000])  # Пробуем распарсить как JSON
                raise FeedValidationError(
                    message="Некорректный формат файла дельта-фида",
                    validation_results={
                        "format_error": True,
                        "error_message": "Файл содержит JSON данные, ожидается CSV формат",
                        "detected_format": "JSON"
                    }
                )
            except (json.JSONDecodeError, ValueError):
                pass  # Не JSON, продолжаем
    
    def _get_file_content(self) -> str:
        """
        Получение содержимого файла в виде строки
        
        Returns:
            Содержимое файла в UTF-8
        """
        try:
            # КРИТИЧЕСКАЯ ПРОВЕРКА: убеждаемся, что self.headers это словарь
            if not hasattr(self, 'headers') or not isinstance(self.headers, dict):
                logger.warning(f"⚠️ КРИТИЧНО: self.headers не является словарем в начале _get_file_content! Тип: {type(getattr(self, 'headers', None))}")
                self.headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/csv, application/csv, */*; q=0.01',
                    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Cache-Control': 'max-age=0',
                }
                logger.info(f"✅ self.headers восстановлен в начале _get_file_content")
            
            if self.file_content:
                try:
                    # Пробуем UTF-8
                    content = self.file_content.decode('utf-8')
                    
                    # Проверяем формат файла
                    # Убеждаемся, что content это строка, а не список
                    if not isinstance(content, str):
                        logger.error(f"❌ КРИТИЧНО: content не является строкой! Тип: {type(content)}, значение: {content}")
                        raise ValueError(f"content должен быть строкой, получен {type(content)}")
                    
                    self._validate_file_format(content)
                    
                    return content
                except UnicodeDecodeError:
                    # Пробуем другие кодировки
                    try:
                        content = self.file_content.decode('cp1251')
                        logger.warning("Файл декодирован как CP1251, рекомендуется UTF-8")
                        return content
                    except UnicodeDecodeError:
                        raise FeedValidationError(
                            message="Не удалось декодировать файл. Требуется кодировка UTF-8",
                            validation_results={}
                        )
            elif self.site_url:
                # Загрузка по URL
                try:
                    logger.info(f"🌐 Загрузка дельта-фида по URL: {self.site_url}")
                    
                    # ВАЖНО: Проверяем и исправляем self.headers ПЕРЕД использованием
                    logger.info(f"🔍 Проверка self.headers: тип={type(self.headers)}, значение={self.headers}")
                    if not isinstance(self.headers, dict):
                        logger.warning(f"⚠️ self.headers не является словарем, тип: {type(self.headers)}, пересоздаем...")
                        self.headers = {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/csv, application/csv, */*; q=0.01',
                            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Connection': 'keep-alive',
                            'Upgrade-Insecure-Requests': '1',
                            'Sec-Fetch-Dest': 'document',
                            'Sec-Fetch-Mode': 'navigate',
                            'Sec-Fetch-Site': 'none',
                            'Cache-Control': 'max-age=0',
                        }
                        logger.info(f"✅ self.headers восстановлен: тип={type(self.headers)}")
                    
                    # Добавляем Referer заголовок, указывающий на тот же домен
                    from urllib.parse import urlparse
                    parsed_url = urlparse(self.site_url)
                    referer_url = f"{parsed_url.scheme}://{parsed_url.netloc}/"
                    
                    # Дополнительная проверка перед распаковкой
                    if not isinstance(self.headers, dict):
                        raise ValueError(f"self.headers все еще не словарь после проверки! Тип: {type(self.headers)}")
                    
                    request_headers = {**self.headers, 'Referer': referer_url}
                    logger.info(f"📋 Используем Referer: {referer_url}")
                    
                    # Определяем метод запроса
                    # Для PHP файлов сначала пробуем GET, если не получается - POST
                    url_request = None
                    if self.site_url[-3:].lower() == 'php':
                        # Сначала пробуем GET
                        try:
                            logger.info(f"📡 Пробуем GET запрос для PHP файла...")
                            url_request = requests.get(self.site_url, headers=request_headers, timeout=300, allow_redirects=True)
                            url_request.raise_for_status()
                            logger.info(f"✅ GET запрос успешен: status={url_request.status_code}")
                        except requests.exceptions.HTTPError as e:
                            if e.response and e.response.status_code == 405:
                                # Если GET не разрешен, пробуем POST
                                logger.info(f"⚠️ GET вернул 405, пробуем POST...")
                                url_request = requests.post(self.site_url, headers=request_headers, timeout=300, allow_redirects=True)
                                url_request.raise_for_status()
                                logger.info(f"✅ POST запрос успешен: status={url_request.status_code}")
                            else:
                                raise
                    else:
                        # Для не-PHP файлов используем GET
                        logger.info(f"📡 Выполнение GET запроса...")
                        url_request = requests.get(self.site_url, headers=request_headers, timeout=300, allow_redirects=True)
                        url_request.raise_for_status()
                    
                    # Преобразуем headers в словарь безопасно
                    headers_dict = {}
                    if url_request.headers:
                        try:
                            # Проверяем тип headers перед преобразованием
                            if isinstance(url_request.headers, dict):
                                headers_dict = dict(url_request.headers)
                            elif hasattr(url_request.headers, 'items'):
                                headers_dict = dict(url_request.headers.items())
                            elif isinstance(url_request.headers, (list, tuple)):
                                # Если headers это список, создаем пустой словарь
                                logger.warning(f"⚠️ headers является списком, пропускаем: {url_request.headers}")
                                headers_dict = {}
                            else:
                                # Пробуем преобразовать в словарь
                                headers_dict = dict(url_request.headers)
                        except (TypeError, ValueError, AttributeError) as e:
                            # Если headers не словарь, создаем пустой словарь
                            logger.warning(f"⚠️ Не удалось преобразовать headers в словарь: {e}, тип: {type(url_request.headers)}")
                            headers_dict = {}
                    
                    logger.info(f"✅ Получен ответ: status={url_request.status_code}, headers={headers_dict}")
                    logger.info(f"🔍 Тип headers_dict: {type(headers_dict)}, isinstance dict: {isinstance(headers_dict, dict)}")
                    
                    # Определяем кодировку
                    content_bytes = url_request.content
                    content_preview = content_bytes[:1000].decode('utf-8', errors='ignore')
                    
                    if 'UTF-8' in content_preview or 'utf-8' in content_preview:
                        encoding = 'utf-8'
                        content = content_bytes.decode('utf-8', errors='replace')
                    elif 'windows-1251' in content_preview:
                        encoding = 'cp1251'
                        content = content_bytes.decode('cp1251', errors='replace')
                    else:
                        encoding = 'utf-8'
                        content = content_bytes.decode('utf-8', errors='replace')
                    
                    logger.info(f"📄 Декодировано с {encoding}, длина: {len(content)} символов")
                    
                    # Проверяем формат файла - используем уже созданный headers_dict
                    # Убеждаемся, что headers_dict это словарь
                    if not isinstance(headers_dict, dict):
                        logger.warning(f"⚠️ headers_dict не является словарем перед _validate_file_format, тип: {type(headers_dict)}, значение: {headers_dict}")
                        headers_dict = {}
                    
                    logger.info(f"🔍 Перед _validate_file_format, headers_dict тип: {type(headers_dict)}")
                    self._validate_file_format(content, headers_dict)
                    
                    return content
                    
                except requests.exceptions.ConnectionError as e:
                    logger.error(f"Ошибка подключения к {self.site_url}: {e}")
                    raise FeedDownloadError(
                        message=f"Не удалось подключиться к URL: {self.site_url}",
                        error_code="CONNECTION_ERROR",
                        url=self.site_url,
                        details={
                            "error_type": "ConnectionError",
                            "technical_message": str(e),
                            "suggestion": "Проверьте, что адрес правильный и сервер доступен"
                        }
                    )
                except requests.exceptions.Timeout as e:
                    logger.error(f"Таймаут при загрузке {self.site_url}: {e}")
                    raise FeedDownloadError(
                        message=f"Превышено время ожидания при загрузке фида (300 секунд)",
                        error_code="TIMEOUT_ERROR",
                        url=self.site_url,
                        details={
                            "error_type": "Timeout",
                            "timeout_seconds": 300,
                            "technical_message": str(e),
                            "suggestion": "Попробуйте позже или проверьте скорость соединения"
                        }
                    )
                except requests.exceptions.HTTPError as e:
                    status_code = e.response.status_code if e.response else 0
                    logger.error(f"HTTP ошибка {status_code} для {self.site_url}: {e}")
                    
                    error_messages = {
                        404: ("Дельта-фид не найден (404)", "NOT_FOUND", "Проверьте правильность URL"),
                        403: ("Доступ запрещен (403)", "FORBIDDEN", "Возможно, сервер блокирует запросы"),
                        401: ("Требуется авторизация (401)", "UNAUTHORIZED", "Необходима авторизация для доступа к фиду"),
                        500: ("Ошибка сервера (500)", "SERVER_ERROR", "Проблема на стороне сервера"),
                        502: ("Bad Gateway (502)", "BAD_GATEWAY", "Сервер недоступен"),
                        503: ("Service Unavailable (503)", "SERVICE_UNAVAILABLE", "Сервис временно недоступен"),
                    }
                    
                    if status_code in error_messages:
                        msg, code, suggestion = error_messages[status_code]
                    else:
                        msg = f"Ошибка HTTP {status_code}" if status_code > 0 else "Ошибка при загрузке дельта-фида"
                        code = f"HTTP_{status_code}" if status_code > 0 else "HTTP_ERROR"
                        suggestion = "Проверьте URL и доступность сервера"
                    
                    # Безопасно преобразуем headers в словарь
                    response_headers = {}
                    if e.response and e.response.headers:
                        try:
                            if isinstance(e.response.headers, dict):
                                response_headers = dict(e.response.headers)
                            elif hasattr(e.response.headers, 'items'):
                                response_headers = dict(e.response.headers.items())
                            else:
                                response_headers = {}
                        except (TypeError, ValueError, AttributeError):
                            response_headers = {}
                    
                    raise FeedDownloadError(
                        message=msg,
                        error_code=code,
                        url=self.site_url,
                        status_code=status_code if status_code > 0 else None,
                        details={
                            "error_type": "HTTPError",
                            "technical_message": str(e),
                            "suggestion": suggestion,
                            "response_headers": response_headers
                        }
                    )
                except requests.exceptions.RequestException as e:
                    logger.error(f"Ошибка запроса к {self.site_url}: {e}")
                    logger.error(f"Тип исключения: {type(e).__name__}")
                    logger.error(f"Детали: {str(e)}")
                    
                    # Определяем более конкретный тип ошибки
                    error_code = "REQUEST_ERROR"
                    error_message = "Ошибка при загрузке дельта-фида"
                    
                    if isinstance(e, requests.exceptions.SSLError):
                        error_code = "SSL_ERROR"
                        error_message = "Ошибка SSL сертификата при загрузке дельта-фида"
                    elif isinstance(e, requests.exceptions.InvalidURL):
                        error_code = "INVALID_URL"
                        error_message = "Некорректный URL дельта-фида"
                    
                    raise FeedDownloadError(
                        message=error_message,
                        error_code=error_code,
                        url=self.site_url,
                        details={
                            "error_type": type(e).__name__,
                            "technical_message": str(e),
                            "suggestion": "Проверьте URL и попробуйте снова"
                        }
                    )
                except Exception as e:
                    # Перехватываем любые другие исключения
                    logger.error(f"Неожиданная ошибка при загрузке дельта-фида {self.site_url}: {e}")
                    logger.error(f"Тип исключения: {type(e).__name__}")
                    import traceback
                    logger.error(f"Traceback: {traceback.format_exc()}")
                    
                    # Убеждаемся, что details это словарь
                    error_details = {
                        "error_type": type(e).__name__,
                        "technical_message": str(e),
                        "suggestion": "Проверьте URL и попробуйте снова. Если проблема повторяется, обратитесь к администратору."
                    }
                    
                    # Дополнительная проверка
                    if not isinstance(error_details, dict):
                        logger.error(f"❌ КРИТИЧНО: error_details не является словарем! Тип: {type(error_details)}")
                        error_details = {"error": str(e)}
                    
                    raise FeedDownloadError(
                        message=f"Неожиданная ошибка при загрузке дельта-фида: {str(e)}",
                        error_code="UNKNOWN_ERROR",
                        url=self.site_url,
                        details=error_details
                    )
        except Exception as outer_e:
            # Перехватываем любые исключения, которые могут произойти в обработке ошибок
            logger.error(f"❌ КРИТИЧЕСКАЯ ОШИБКА при обработке ошибки в _get_file_content: {outer_e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            # Пробрасываем оригинальную ошибку, если это не наша ошибка обработки
            if isinstance(outer_e, (FeedDownloadError, FeedValidationError)):
                raise
            # Иначе создаем простую ошибку
            raise FeedDownloadError(
                message=f"Критическая ошибка при загрузке дельта-фида: {str(outer_e)}",
                error_code="CRITICAL_ERROR",
                url=getattr(self, 'site_url', None),
                details={"error": str(outer_e)}
            )
        else:
            raise FeedValidationError(
                message="Не указан источник данных (file_content или site_url)",
                validation_results={}
            )
    
    def _detect_headers(self, first_line: str) -> bool:
        """
        Определение наличия заголовков в первой строке
        
        Args:
            first_line: Первая строка файла
            
        Returns:
            True если есть заголовки, False если нет
        """
        parts = first_line.split(self.delimiter)
        parts = [p.strip() for p in parts]
        
        # Проверяем, похожи ли значения на заголовки
        # Заголовки обычно содержат буквы и не похожи на числа
        header_indicators = ['id', 'price', 'available', 'oldprice', 'region', 'наличие', 'цвет']
        
        first_part_lower = parts[0].lower() if parts else ''
        
        # Если первая колонка похожа на заголовок
        if any(indicator in first_part_lower for indicator in header_indicators):
            return True
        
        # Если все части похожи на заголовки (содержат буквы, не только цифры)
        if len(parts) >= 3:
            non_numeric_count = sum(1 for p in parts if not p.replace('.', '').replace('-', '').isdigit())
            if non_numeric_count >= 2:  # Хотя бы 2 колонки не числовые
                return True
        
        return False
    
    def _parse_row(self, row_data: List[str], row_number: int, field_mapping: Dict[int, str] = None) -> Dict[str, Any]:
        """
        Парсинг строки дельта-фида
        
        Args:
            row_data: Список значений из CSV строки
            row_number: Номер строки (для отчетов)
            field_mapping: Маппинг индексов колонок на имена полей (если есть заголовки)
            
        Returns:
            Словарь с распарсенными данными
        """
        parsed = {
            'row_number': row_number,
            'id': None,
            'price': None,
            'available': None,
            'oldPrice': None,
            'regionExternalId': None,
            'attributes': {},
            'raw_data': row_data
        }
        
        # Если есть маппинг полей (заголовки)
        if field_mapping:
            for col_index, field_name in field_mapping.items():
                if col_index < len(row_data):
                    value = row_data[col_index].strip()
                    
                    # Обязательные поля
                    if field_name.lower() == 'id':
                        parsed['id'] = value
                    elif field_name.lower() == 'price':
                        parsed['price'] = value
                    elif field_name.lower() == 'available':
                        parsed['available'] = value
                    # Опциональные поля
                    elif field_name == 'oldPrice':
                        parsed['oldPrice'] = value if value else None
                    elif field_name == 'regionExternalId':
                        parsed['regionExternalId'] = value if value else None
                    # Атрибуты (все остальные поля)
                    else:
                        if value:
                            parsed['attributes'][field_name] = value
                            self.attribute_names.add(field_name)
        else:
            # Нет заголовков - используем позиционный формат
            # Формат: id, price, available [, regionExternalId] [, дополнительные поля]
            if len(row_data) >= 3:
                parsed['id'] = row_data[0].strip()
                parsed['price'] = row_data[1].strip()
                parsed['available'] = row_data[2].strip()
                
                # Опциональный regionExternalId в 4-й позиции
                if len(row_data) >= 4:
                    region_value = row_data[3].strip()
                    if region_value:
                        parsed['regionExternalId'] = region_value
                
                # Дополнительные поля (5-я позиция и далее) сохраняем как атрибуты
                if len(row_data) >= 5:
                    for idx in range(4, len(row_data)):
                        attr_name = f"field_{idx + 1}"
                        attr_value = row_data[idx].strip()
                        if attr_value:
                            parsed['attributes'][attr_name] = attr_value
                            self.attribute_names.add(attr_name)
        
        return parsed
    
    def _validate_row(self, row: Dict[str, Any]) -> List[str]:
        """
        Валидация строки дельта-фида
        
        Args:
            row: Распарсенная строка
            
        Returns:
            Список типов проблем (пустой если проблем нет)
        """
        problems = []
        
        # Проверка ID
        if not row['id'] or not row['id'].strip():
            problems.append('missing_id')
        
        # Проверка цены
        if not row['price'] or not row['price'].strip():
            problems.append('missing_price')
        else:
            try:
                price_value = float(row['price'].replace(',', '.'))
                if price_value <= 0:
                    problems.append('invalid_price')
            except (ValueError, AttributeError):
                problems.append('invalid_price')
        
        # Проверка available
        if row['available'] is None or not str(row['available']).strip():
            problems.append('missing_available')
        
        return problems
    
    def _is_available(self, available_value: str) -> bool:
        """
        Определение доступности товара
        
        Args:
            available_value: Значение поля available
            
        Returns:
            True если товар в наличии, False если нет
        """
        if available_value is None:
            return False
        
        available_str = str(available_value).strip()
        return available_str in self.available_true_values
    
    def parse(self) -> Dict[str, Any]:
        """
        Парсинг дельта-фида
        
        Returns:
            Словарь с результатами парсинга
        """
        try:
            content = self._get_file_content()
            if not content or not content.strip():
                raise FeedValidationError(
                    message="Файл пуст или не содержит корректных данных",
                    validation_results={
                        "parsing_error": True,
                        "error_message": "Файл не содержит корректных данных"
                    }
                )
            
            lines = content.strip().split('\n')
            
            if not lines:
                raise FeedValidationError(
                    message="Файл пуст",
                    validation_results={
                        "parsing_error": True,
                        "error_message": "Файл не содержит строк"
                    }
                )
        except FeedValidationError:
            raise
        except Exception as e:
            logger.error(f"Ошибка при получении содержимого файла: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise FeedValidationError(
                message=f"Ошибка при чтении файла: {str(e)}",
                validation_results={
                    "parsing_error": True,
                    "error_message": str(e),
                    "error_type": type(e).__name__
                }
            )
        
        # Определяем наличие заголовков
        first_line = lines[0].strip()
        self.has_headers = self._detect_headers(first_line)
        
        # Парсим заголовки если есть
        field_mapping = {}  # Индекс колонки -> имя поля
        if self.has_headers:
            header_parts = first_line.split(self.delimiter)
            for idx, header in enumerate(header_parts):
                field_mapping[idx] = header.strip()
            self.csv_headers = [h.strip() for h in header_parts]
            logger.info(f"Обнаружены заголовки: {self.csv_headers}")
            start_row = 1  # Пропускаем строку заголовков
        else:
            logger.info("Заголовки не обнаружены, используется позиционный формат")
            start_row = 0
        
        # Парсим строки данных
        id_counter = Counter()
        parse_errors = []
        
        for line_idx, line in enumerate(lines[start_row:], start=start_row + 1):
            line = line.strip()
            if not line:  # Пропускаем пустые строки
                continue
            
            # Парсим CSV строку
            try:
                # Используем csv.reader для правильной обработки кавычек
                csv_reader = csv.reader([line], delimiter=self.delimiter)
                row_data = next(csv_reader)
            except Exception as e:
                error_msg = f"Ошибка парсинга строки {line_idx}: {e}. Строка: {line[:100]}"
                logger.warning(error_msg)
                parse_errors.append({
                    "line": line_idx,
                    "error": str(e),
                    "content": line[:100]
                })
                continue
            
            # Парсим строку
            parsed_row = self._parse_row(row_data, line_idx, field_mapping if self.has_headers else None)
            
            # Валидация
            problems = self._validate_row(parsed_row)
            for problem in problems:
                self.problems[problem].append(parsed_row)
            
            # Подсчет статистики
            if parsed_row['id']:
                id_counter[parsed_row['id']] += 1
                self.unique_ids.add(parsed_row['id'])
            
            # Подсчет доступности
            if parsed_row['available']:
                if self._is_available(parsed_row['available']):
                    self.available_count += 1
                else:
                    self.unavailable_count += 1
            
            # Опциональные поля
            if parsed_row.get('oldPrice'):
                self.rows_with_oldprice += 1
            
            if parsed_row.get('regionExternalId'):
                self.rows_with_region += 1
            
            if parsed_row.get('attributes'):
                self.rows_with_attributes += 1
            
            self.rows.append(parsed_row)
            self.total_rows += 1
        
        # Проверяем, были ли распарсены хотя бы какие-то строки
        if self.total_rows == 0:
            error_msg = "Не удалось распарсить ни одной строки данных"
            if parse_errors:
                error_msg += f". Обнаружено {len(parse_errors)} ошибок парсинга."
            logger.error(error_msg)
            raise FeedValidationError(
                message=error_msg,
                validation_results={
                    "parsing_error": True,
                    "error_message": error_msg,
                    "parse_errors": parse_errors[:10] if parse_errors else [],
                    "total_lines": len(lines),
                    "has_headers": self.has_headers
                }
            )
        
        # Анализ дубликатов
        for product_id, count in id_counter.items():
            if count > 1:
                duplicate_rows = [r for r in self.rows if r['id'] == product_id]
                self.duplicate_ids_details.append({
                    'id': product_id,
                    'count': count,
                    'rows': [
                        {
                            'row_number': r['row_number'],
                            'price': r['price'],
                            'available': r['available'],
                            'regionExternalId': r.get('regionExternalId')
                        }
                        for r in duplicate_rows
                    ]
                })
                self.problems['duplicate_ids'].extend(duplicate_rows)
        
        # Логируем ошибки парсинга если есть
        if parse_errors:
            logger.warning(f"Обнаружено {len(parse_errors)} ошибок парсинга строк")
            if len(parse_errors) <= 10:
                for err in parse_errors:
                    logger.warning(f"  Строка {err['line']}: {err['error']}")
        
        result = {
            'total_rows': self.total_rows,
            'has_headers': self.has_headers,
            'headers': self.csv_headers if self.has_headers else None
        }
        
        # Добавляем информацию об ошибках парсинга если есть
        if parse_errors:
            result['parse_errors'] = parse_errors[:10]  # Первые 10 ошибок
            result['parse_errors_count'] = len(parse_errors)
        
        logger.info(f"Успешно распарсено {self.total_rows} строк из {len(lines)} всего строк")
        
        return result
    
    def run_full_check(self) -> Dict[str, Any]:
        """
        Запуск полной проверки дельта-фида
        
        Returns:
            Словарь с результатами проверки
        """
        logger.info(f"🔍 Начинаем проверку дельта-фида для site_id={self.site_id}")
        
        try:
            # Парсинг
            parsing_result = self.parse()
        except FeedValidationError as e:
            logger.error(f"Ошибка валидации при парсинге дельта-фида: {e.message}")
            logger.error(f"Детали: {e.validation_results}")
            # Пробрасываем дальше, чтобы backend мог обработать
            raise
        except Exception as e:
            logger.error(f"Неожиданная ошибка при парсинге дельта-фида: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise FeedValidationError(
                message=f"Ошибка при парсинге дельта-фида: {str(e)}",
                validation_results={
                    "parsing_error": True,
                    "error_message": str(e),
                    "error_type": type(e).__name__
                }
            )
        
        # Формируем результат
        result = {
            'site_id': self.site_id,
            'parsing': parsing_result,
            'summary': {
                'total_rows': self.total_rows,
                'available_count': self.available_count,
                'unavailable_count': self.unavailable_count,
                'unique_ids_count': len(self.unique_ids)
            },
            'problems': {
                'missing_id': len(self.problems['missing_id']),
                'missing_price': len(self.problems['missing_price']),
                'invalid_price': len(self.problems['invalid_price']),
                'missing_available': len(self.problems['missing_available']),
                'duplicate_ids': len(set(r['id'] for r in self.problems['duplicate_ids'] if r['id']))
            },
            'optional_fields': {
                'rows_with_oldprice': self.rows_with_oldprice,
                'rows_with_region': self.rows_with_region,
                'rows_with_attributes': self.rows_with_attributes,
                'attribute_names': sorted(list(self.attribute_names))
            },
            'duplicate_ids_details': self.duplicate_ids_details
        }
        
        logger.info(f"✅ Проверка завершена: {self.total_rows} строк, {len(self.unique_ids)} уникальных ID")
        
        return result

