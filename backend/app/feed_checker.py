import re
import requests
from collections import Counter, defaultdict
from enum import Enum
from lxml import etree
from io import BytesIO
import logging
import time
from typing import Dict, List, Optional, Tuple
from datetime import datetime

from app.exceptions import FeedDownloadError, FeedValidationError

# Логирование уже настроено в main.py, просто получаем logger
logger = logging.getLogger(__name__)

class ProblemType(Enum):
    MISSING_ID = "без тега <id> или с пустым <id>"
    MISSING_AVAILABLE = "без параметра <available> или с пустым <available>"
    MISSING_NAME = "без тэга <name>, либо без комбинации <typePrefix> + <vendor> + <model>"
    MISSING_LINK = "без ссылки на карточку товара"
    PRICE_ISSUES = "с отрицательной, равной нулю или без цены"
    MISSING_CATEGORY = "без как минимум одной категории"
    INVALID_CATEGORY = "с категорией, которой нет в дереве категорий"
    MULTIPLE_CATEGORIES = "в нескольких категориях, список их categoryId не обёрнут в тег <categories>"
    MISSING_VENDOR = "без тэга <vendor>, с пустым <vendor> или содержащих плохие значения (Null, Без бренда, Нет, Не указан и т.п.)"
    MISSING_IMAGE = "без ссылки на изображение товара"

class FeedChecker:
    def __init__(self, site_id: int, site_url: str = None, file_content: bytes = None, progress_callback=None):
        self.site_id = site_id
        self.site_url = site_url
        self.file_content = file_content
        self.progress_callback = progress_callback
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/xml, text/xml, */*; q=0.01',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',  # Поддерживаем Brotli
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0',
        }
        self.feed_tree = None
        self.site_offers = None
        self.site_categories = None
        self.available_offers_count = 0
        self.unavailable_offers_count = 0
        self.empty_availability_count = 0
        self.offers_without_id = []
        self.duplicate_ids = []
        self.offers_without_name = []
        self.offers_without_link = []
        self.offers_price_issues = []
        self.offers_without_category = []
        self.offers_invalid_category = []
        self.offers_multiple_categories = []
        self.offers_vendor_issues = []
        self.offers_without_image = []
        self.offers_without_availability = []
        self.brands = set()
        self.categories_ids = []
        self.categories_names = []
        self.categories_full_info = []
        self.empty_categories = []
        self.duplicated_cats = []
        self.dual_categories = []
        self.invalid_param_errors = []  # Ошибки валидации параметров
        self.duplicate_param_errors = []  # Ошибки дубликатов параметров

    def get_url_text(self):
        """Загрузка фида по URL с определением кодировки и отслеживанием прогресса"""
        site_data = None
        try:
            logger.info(f"🌐 Starting download from: {self.site_url}")
            
            # Используем сессию для сохранения cookies
            session = requests.Session()
            
            # Добавляем Referer заголовок, указывающий на тот же домен
            from urllib.parse import urlparse
            parsed_url = urlparse(self.site_url)
            referer_url = f"{parsed_url.scheme}://{parsed_url.netloc}/"
            request_headers = {**self.headers, 'Referer': referer_url}
            logger.info(f"📋 Using Referer: {referer_url}")
            
            # Сначала делаем запрос к главной странице для получения cookies (если нужно)
            # Это может помочь, если сервер проверяет сессию
            try:
                logger.info(f"🍪 Getting initial cookies from main page...")
                main_page_response = session.get(referer_url, headers=self.headers, timeout=10, allow_redirects=True)
                logger.info(f"✅ Got cookies, status: {main_page_response.status_code}")
            except Exception as e:
                logger.warning(f"⚠️ Could not get initial cookies: {e}, continuing anyway...")
            
            # Определяем метод запроса
            # Для PHP файлов сначала пробуем GET, если не получается - POST
            url_request = None
            if self.site_url[-3:].lower() == 'php':
                # Сначала пробуем GET
                try:
                    logger.info(f"📡 Trying GET request for PHP file...")
                    url_request = session.get(self.site_url, headers=request_headers, timeout=300, stream=True, allow_redirects=True)
                    url_request.raise_for_status()
                    logger.info(f"✅ GET request successful: status={url_request.status_code}")
                except requests.exceptions.HTTPError as e:
                    if e.response and e.response.status_code == 405:
                        # Если GET не разрешен, пробуем POST
                        logger.info(f"⚠️ GET returned 405, trying POST...")
                        url_request = session.post(self.site_url, headers=request_headers, timeout=300, stream=True, allow_redirects=True)
                        url_request.raise_for_status()
                        logger.info(f"✅ POST request successful: status={url_request.status_code}")
                    else:
                        raise
            else:
                # Для не-PHP файлов используем GET
                logger.info(f"📡 Making GET request...")
                url_request = session.get(self.site_url, headers=request_headers, timeout=300, stream=True, allow_redirects=True)
                url_request.raise_for_status()
            logger.info(f"✅ Got response: status={url_request.status_code}, headers={dict(url_request.headers)}")
            
            # Получаем размер контента если доступен
            total_size = int(url_request.headers.get('content-length', 0))
            logger.info(f"📦 Content-Length: {total_size} bytes ({total_size / 1024 / 1024:.2f} MB)" if total_size > 0 else "⚠️ Content-Length not provided by server")
            
            # Загружаем с прогрессом
            loaded_size = 0
            chunks = []
            chunk_count = 0
            
            logger.info(f"🔽 Starting to download chunks...")
            
            # Проверяем Content-Type заголовок
            content_type = url_request.headers.get('Content-Type', '').lower()
            logger.info(f"📋 Content-Type: {content_type}")
            
            # Загружаем все chunks
            # Для Brotli нужно загрузить все данные перед декомпрессией
            for chunk in url_request.iter_content(chunk_size=8192):
                if chunk:
                    chunks.append(chunk)
                    loaded_size += len(chunk)
                    chunk_count += 1
                    
                    # Логируем каждый 100-й chunk (каждые ~800KB)
                    if chunk_count % 100 == 0:
                        logger.info(f"📥 Downloaded {chunk_count} chunks, {loaded_size / 1024 / 1024:.2f} MB")
                    
                    # Отправляем прогресс если есть callback
                    if self.progress_callback and total_size > 0:
                        self.progress_callback(loaded_size, total_size)
            
            logger.info(f"✅ Download complete: {chunk_count} chunks, {loaded_size / 1024 / 1024:.2f} MB total")
            
            # Проверяем Content-Encoding заголовок ДО объединения chunks
            content_encoding = url_request.headers.get('Content-Encoding', '').lower()
            logger.info(f"📦 Content-Encoding: {content_encoding}")
            
            # Для больших файлов логируем информацию о chunks
            total_chunks_size = sum(len(c) for c in chunks)
            logger.info(f"📊 Chunks info: count={len(chunks)}, total_size={total_chunks_size / 1024 / 1024:.2f} MB")
            
            # Логируем состояние перед обработкой
            logger.info(f"🔍 About to process content encoding: {content_encoding}")
            logger.info(f"🔍 Memory check: chunks ready={len(chunks) > 0}")
            
            # Если данные сжаты Brotli, используем ручную декомпрессию
            # Для ВСЕХ размеров файлов используем ручную декомпрессию из chunks
            # Это более эффективно по памяти, так как мы контролируем процесс
            # и не загружаем весь файл в память сразу через url_request.content
            if content_encoding == 'br':
                logger.info(f"🔄 Content is Brotli compressed ({total_chunks_size / 1024 / 1024:.2f} MB)")
                logger.info(f"🔄 Using manual decompression from chunks (memory efficient)...")
                logger.info(f"📊 Chunks count: {len(chunks)}, total size: {total_chunks_size / 1024 / 1024:.2f} MB")
                
                try:
                    import brotli
                    logger.info(f"✅ Brotli library imported successfully")
                    
                    # Собираем все сжатые данные из chunks
                    logger.info(f"🔨 Joining {len(chunks)} chunks into single byte array...")
                    logger.info(f"⏱️ Join operation started at: {datetime.now().isoformat()}")
                    
                    # Используем BytesIO для более эффективного объединения
                    buffer = BytesIO()
                    for i, chunk in enumerate(chunks):
                        buffer.write(chunk)
                        if (i + 1) % 500 == 0:
                            logger.info(f"📝 Joined {i + 1}/{len(chunks)} chunks...")
                    compressed_bytes = buffer.getvalue()
                    buffer.close()
                    
                    # Освобождаем chunks сразу после объединения
                    chunks.clear()
                    del chunks
                    
                    logger.info(f"✅ Join complete")
                    logger.info(f"📦 Compressed data size: {len(compressed_bytes) / 1024 / 1024:.2f} MB")
                    
                    # Освобождаем compressed_bytes после декомпрессии
                    try:
                        # Проверяем, не декомпрессированы ли данные уже
                        logger.info(f"🔍 Checking if data is already decompressed...")
                        first_bytes_check = compressed_bytes[:100].decode('utf-8', errors='ignore')
                        if first_bytes_check.strip().startswith('<'):
                            logger.info(f"✅ Data appears to be already decompressed by requests")
                            content_bytes = compressed_bytes
                            del compressed_bytes  # Освобождаем память
                        else:
                            # Пробуем декомпрессировать
                            logger.info(f"🔄 Starting Brotli decompression of {len(compressed_bytes) / 1024 / 1024:.2f} MB...")
                            logger.info(f"⏱️ Decompression started at: {datetime.now().isoformat()}")
                            
                            start_time = time.time()
                            content_bytes = brotli.decompress(compressed_bytes)
                            
                            # Освобождаем compressed_bytes сразу после декомпрессии
                            del compressed_bytes
                            
                            elapsed_time = time.time() - start_time
                            logger.info(f"✅ Brotli decompression successful!")
                            logger.info(f"📊 Decompressed size: {len(content_bytes) / 1024 / 1024:.2f} MB")
                            logger.info(f"⏱️ Decompression took: {elapsed_time:.2f} seconds")
                            logger.info(f"⏱️ Decompression speed: {len(content_bytes) / elapsed_time / 1024 / 1024:.2f} MB/s")
                            
                            # Проверяем результат
                            first_bytes = content_bytes[:100].decode('utf-8', errors='ignore')
                            if first_bytes.strip().startswith('<'):
                                logger.info(f"✅ Content starts with '<' - looks like valid XML")
                            else:
                                logger.warning(f"⚠️ Content doesn't start with '<', but continuing...")
                                
                    except Exception as decomp_error:
                        # Освобождаем память при ошибке
                        if 'compressed_bytes' in locals():
                            del compressed_bytes
                        
                        logger.error(f"❌ Brotli decompression failed: {decomp_error}")
                        logger.error(f"❌ Error type: {type(decomp_error).__name__}")
                        import traceback
                        logger.error(f"❌ Traceback: {traceback.format_exc()}")
                        
                        # Последняя попытка - перезапросить без stream
                        logger.info(f"🔄 Last attempt: retrying without stream for auto-decompression...")
                        url_request.close()
                        if self.site_url[-3:].lower() == 'php':
                            try:
                                url_request = session.get(self.site_url, headers=request_headers, timeout=600, allow_redirects=True)
                                url_request.raise_for_status()
                            except requests.exceptions.HTTPError as e:
                                if e.response and e.response.status_code == 405:
                                    url_request = session.post(self.site_url, headers=request_headers, timeout=600, allow_redirects=True)
                                    url_request.raise_for_status()
                                else:
                                    raise
                        else:
                            url_request = session.get(self.site_url, headers=request_headers, timeout=600, allow_redirects=True)
                            url_request.raise_for_status()
                        
                        content_bytes = url_request.content
                        logger.info(f"✅ Got content from retry: {len(content_bytes) / 1024 / 1024:.2f} MB")
                
                except ImportError:
                    logger.error(f"❌ brotli library not installed")
                    # Освобождаем chunks
                    chunks.clear()
                    del chunks
                    
                    # Пробуем перезапросить без stream
                    logger.info(f"🔄 Retrying without stream for auto-decompression...")
                    url_request.close()
                    if self.site_url[-3:].lower() == 'php':
                        try:
                            url_request = session.get(self.site_url, headers=request_headers, timeout=600, allow_redirects=True)
                            url_request.raise_for_status()
                        except requests.exceptions.HTTPError as e:
                            if e.response and e.response.status_code == 405:
                                url_request = session.post(self.site_url, headers=request_headers, timeout=600, allow_redirects=True)
                                url_request.raise_for_status()
                            else:
                                raise
                    else:
                        url_request = session.get(self.site_url, headers=request_headers, timeout=600, allow_redirects=True)
                        url_request.raise_for_status()
                    
                    content_bytes = url_request.content
                    logger.info(f"✅ Got content from retry (no brotli lib): {len(content_bytes) / 1024 / 1024:.2f} MB")
                except Exception as e:
                    # Освобождаем память при ошибке
                    if 'chunks' in locals():
                        chunks.clear()
                        del chunks
                    if 'compressed_bytes' in locals():
                        del compressed_bytes
                        
                    logger.error(f"❌ Brotli handling failed: {e}")
                    logger.error(f"❌ Error type: {type(e).__name__}")
                    import traceback
                    logger.error(f"❌ Full traceback: {traceback.format_exc()}")
                    
                    # Последняя попытка
                    try:
                        logger.info(f"🔄 Last attempt: retrying without stream...")
                        url_request.close()
                        if self.site_url[-3:].lower() == 'php':
                            try:
                                url_request = session.get(self.site_url, headers=request_headers, timeout=600, allow_redirects=True)
                                url_request.raise_for_status()
                            except requests.exceptions.HTTPError as e:
                                if e.response and e.response.status_code == 405:
                                    url_request = session.post(self.site_url, headers=request_headers, timeout=600, allow_redirects=True)
                                    url_request.raise_for_status()
                                else:
                                    raise
                        else:
                            url_request = session.get(self.site_url, headers=request_headers, timeout=600, allow_redirects=True)
                            url_request.raise_for_status()
                        
                        content_bytes = url_request.content
                        logger.info(f"✅ Got content from last retry: {len(content_bytes) / 1024 / 1024:.2f} MB")
                    except Exception as retry_error:
                        logger.error(f"❌ Last retry also failed: {retry_error}")
                        raise FeedDownloadError(
                            message=f"Не удалось декомпрессировать данные (Brotli): {str(e)}",
                            error_code="DECOMPRESSION_ERROR",
                            url=self.site_url,
                            details={
                                "error_type": "DecompressionError",
                                "content_encoding": content_encoding,
                                "technical_message": str(e),
                                "retry_error": str(retry_error),
                                "suggestion": "Проверьте установку библиотеки brotli: pip install brotli"
                            }
                        )
            elif content_encoding in ('gzip', 'deflate'):
                # Для gzip/deflate используем автоматическую декомпрессию requests
                logger.info(f"🔄 Content is compressed ({content_encoding}), using auto-decompression...")
                url_request.close()
                if self.site_url[-3:].lower() == 'php':
                    try:
                        url_request = session.get(self.site_url, headers=request_headers, timeout=300, allow_redirects=True)
                        url_request.raise_for_status()
                    except requests.exceptions.HTTPError as e:
                        if e.response and e.response.status_code == 405:
                            url_request = session.post(self.site_url, headers=request_headers, timeout=300, allow_redirects=True)
                            url_request.raise_for_status()
                        else:
                            raise
                else:
                    url_request = session.get(self.site_url, headers=request_headers, timeout=300, allow_redirects=True)
                    url_request.raise_for_status()
                content_bytes = url_request.content
                logger.info(f"✅ Got auto-decompressed content: {len(content_bytes)} bytes")
            else:
                # Собираем весь контент из chunks (не сжато)
                # Проверяем, что chunks существует и не пустой
                if not chunks or len(chunks) == 0:
                    logger.error(f"❌ No chunks available for uncompressed content")
                    raise FeedDownloadError(
                        message="Не удалось загрузить данные: файл пуст или не был загружен",
                        error_code="EMPTY_CONTENT",
                        url=self.site_url,
                        details={"chunks_count": 0}
                    )
                
                # Для больших файлов используем BytesIO
                if total_chunks_size > 100 * 1024 * 1024:  # > 100 MB
                    logger.info(f"⚠️ Large uncompressed file ({total_chunks_size / 1024 / 1024:.2f} MB), using BytesIO...")
                    buffer = BytesIO()
                    for i, chunk in enumerate(chunks):
                        buffer.write(chunk)
                        if (i + 1) % 500 == 0:
                            logger.info(f"📝 Joined {i + 1}/{len(chunks)} chunks...")
                    content_bytes = buffer.getvalue()
                    buffer.close()
                    logger.info(f"✅ Joined {len(chunks)} chunks using BytesIO: {len(content_bytes) / 1024 / 1024:.2f} MB")
                else:
                    content_bytes = b''.join(chunks)
                    logger.info(f"🔨 Joined {len(chunks)} chunks: {len(content_bytes) / 1024 / 1024:.2f} MB")

            # Освобождаем память от chunks (если еще не освобождены)
            # Проверяем, что chunks существует и не был уже удален
            try:
                if 'chunks' in locals() and chunks is not None:
                    chunks.clear()
                    del chunks
                    logger.info(f"🗑️ Cleared chunks from memory")
            except (NameError, UnboundLocalError):
                # chunks уже был удален - это нормально
                pass
            
            # Определяем кодировку
            content_preview = content_bytes[:1000].decode('utf-8', errors='ignore')
            
            if 'UTF-8' in content_preview or 'utf-8' in content_preview:
                encoding = 'utf-8'
                site_data = content_bytes.decode('utf-8', errors='replace')
            elif 'windows-1251' in content_preview:
                encoding = 'cp1251'
                site_data = content_bytes.decode('cp1251', errors='replace')
            else:
                encoding = 'utf-8'
                site_data = content_bytes.decode('utf-8', errors='replace')
            
            logger.info(f"📄 Decoded with {encoding}, final text length: {len(site_data)} characters")
            
            # Логируем начало содержимого для отладки
            if site_data:
                logger.info(f"📋 First 200 chars of decoded content: {repr(site_data[:200])}")
                logger.info(f"🔤 First 50 bytes (hex): {site_data[:50].encode(encoding, errors='replace').hex()}")
                
                # Удаляем BOM если есть
                if site_data.startswith('\ufeff'):  # UTF-8 BOM
                    logger.warning(f"⚠️ Found UTF-8 BOM, stripping it")
                    site_data = site_data[1:]
                elif site_data.startswith('\xef\xbb\xbf'):  # UTF-8 BOM in bytes (если не декодировался)
                    logger.warning(f"⚠️ Found UTF-8 BOM (bytes), stripping it")
                    site_data = site_data[3:]
                
                # Удаляем ведущие пробелы и переносы строк
                site_data = site_data.lstrip()
            else:
                logger.error(f"❌ site_data is empty or None!")
            
            logger.info(f"🎉 get_url_text() completed successfully, returning {len(site_data)} characters")
            return site_data
            
        except requests.exceptions.ConnectionError as e:
            logger.error(f"Connection error for {self.site_url}: {e}")
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
            logger.error(f"Timeout error for {self.site_url}: {e}")
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
            logger.error(f"HTTP error {status_code} for {self.site_url}: {e}")
            
            error_messages = {
                404: ("Фид не найден (404)", "NOT_FOUND", "Проверьте правильность URL"),
                403: ("Доступ запрещен (403)", "FORBIDDEN", "Возможно, сервер блокирует запросы"),
                401: ("Требуется авторизация (401)", "UNAUTHORIZED", "Необходима авторизация для доступа к фиду"),
                500: ("Ошибка сервера (500)", "SERVER_ERROR", "Проблема на стороне сервера"),
                502: ("Bad Gateway (502)", "BAD_GATEWAY", "Сервер недоступен"),
                503: ("Service Unavailable (503)", "SERVICE_UNAVAILABLE", "Сервис временно недоступен"),
            }
            
            if status_code in error_messages:
                msg, code, suggestion = error_messages[status_code]
            else:
                msg = f"Ошибка HTTP {status_code}"
                code = f"HTTP_{status_code}"
                suggestion = "Проверьте URL и доступность сервера"
            
            raise FeedDownloadError(
                message=msg,
                error_code=code,
                url=self.site_url,
                status_code=status_code,
                details={
                    "error_type": "HTTPError",
                    "technical_message": str(e),
                    "suggestion": suggestion,
                    "response_headers": dict(e.response.headers) if e.response else {}
                }
            )
        except requests.exceptions.RequestException as e:
            logger.error(f"Request error for {self.site_url}: {e}")
            raise FeedDownloadError(
                message=f"Ошибка при загрузке фида",
                error_code="REQUEST_ERROR",
                url=self.site_url,
                details={
                    "error_type": type(e).__name__,
                    "technical_message": str(e),
                    "suggestion": "Проверьте URL и попробуйте снова"
                }
            )
        
        return site_data

    def _get_error_context(self, content: str, line_num: int, context_lines: int = 3) -> Dict:
        """Получить контекст ошибки (несколько строк вокруг проблемной строки)"""
        lines = content.split('\n')
        start = max(0, line_num - context_lines - 1)
        end = min(len(lines), line_num + context_lines)
        
        context = []
        for i in range(start, end):
            context.append({
                "line_number": i + 1,
                "content": lines[i] if i < len(lines) else "",
                "is_error_line": i + 1 == line_num
            })
        
        return {
            "error_line": lines[line_num - 1] if 0 < line_num <= len(lines) else "",
            "context": context
        }
    
    def _truncate_line_with_context(self, line: str, error_column: int, max_length: int = 200, context_before: int = 50, context_after: int = 50) -> Dict:
        """Обрезать длинную строку, показывая контекст вокруг ошибки"""
        if not line or len(line) <= max_length:
            return {
                "truncated": False,
                "full_line": line,
                "preview": line,
                "error_position": error_column
            }
        
        # Определяем позицию начала и конца для показа
        start_pos = max(0, error_column - context_before)
        end_pos = min(len(line), error_column + context_after)
        
        # Если строка очень длинная, обрезаем
        if end_pos - start_pos > max_length:
            # Центрируем вокруг ошибки
            start_pos = max(0, error_column - max_length // 2)
            end_pos = min(len(line), start_pos + max_length)
        
        preview = line[start_pos:end_pos]
        truncated_before = start_pos > 0
        truncated_after = end_pos < len(line)
        
        # Добавляем индикаторы обрезки
        if truncated_before:
            preview = "..." + preview
        if truncated_after:
            preview = preview + "..."
        
        return {
            "truncated": True,
            "full_line": line,
            "preview": preview,
            "error_position": error_column - start_pos + (3 if truncated_before else 0),
            "start_pos": start_pos,
            "end_pos": end_pos,
            "line_length": len(line)
        }
    
    def _check_unescaped_ampersand(self, text: str, error_column: int = None) -> Tuple[bool, str]:
        """Проверить наличие неэкранированного амперсанда в тексте"""
        if not text or "&" not in text:
            return False, ""
        
        import re
        # Валидные XML сущности: &amp; &lt; &gt; &quot; &apos; или &#число; или &#xhex;
        # Ищем амперсанды, которые НЕ являются валидными сущностями
        # Паттерн: & не за которым следует:
        # - amp; или lt; или gt; или quot; или apos; (стандартные сущности)
        # - #число; (числовая сущность)
        # - #xhex; (hex сущность)
        # - [a-zA-Z][a-zA-Z0-9]*; (именованная сущность)
        
        # Ищем все амперсанды
        ampersand_positions = [m.start() for m in re.finditer(r'&', text)]
        
        for pos in ampersand_positions:
            # Проверяем, что следует после &
            after_amp = text[pos + 1:pos + 100]  # Берем следующий фрагмент
            
            # Проверяем стандартные сущности
            if after_amp.startswith(('amp;', 'lt;', 'gt;', 'quot;', 'apos;')):
                continue
            
            # Проверяем числовые сущности &#число; или &#xhex;
            if after_amp.startswith('#'):
                # Ищем паттерн &#число; или &#xhex;
                if re.match(r'#\d+;', after_amp) or re.match(r'#x[0-9a-fA-F]+;', after_amp):
                    continue
            
            # Проверяем именованные сущности [a-zA-Z][a-zA-Z0-9]*;
            if re.match(r'[a-zA-Z][a-zA-Z0-9]*;', after_amp):
                continue
            
            # Если дошли сюда, значит это неэкранированный амперсанд
            # Находим контекст вокруг амперсанда
            context_start = max(0, pos - 30)
            context_end = min(len(text), pos + 50)
            context = text[context_start:context_end]
            if context_start > 0:
                context = "..." + context
            if context_end < len(text):
                context = context + "..."
            
            hint = f"Обнаружен неэкранированный амперсанд (&) на позиции {pos + 1}. Замените & на &amp;"
            if error_column and abs(pos - error_column) < 10:
                # Если ошибка рядом с амперсандом, это скорее всего и есть проблема
                hint = f"Обнаружен неэкранированный амперсанд (&) - замените на &amp;"
            
            return True, hint
        
        return False, ""
    
    def _translate_xml_error(self, error_msg: str) -> str:
        """Перевести техническую ошибку XML на понятный русский язык"""
        translations = {
            "Opening and ending tag mismatch": "Открывающий и закрывающий теги не совпадают",
            "Premature end of data": "Неожиданный конец файла - возможно не закрыты теги",
            "Extra content at the end": "Лишнее содержимое после закрывающего тега",
            "attributes construct error": "Ошибка в атрибутах тега",
            "expected '>'": "Ожидается символ '>' для закрытия тега",
            "expected '<'": "Ожидается символ '<' для открытия тега",
            "Blank needed here": "Требуется пробел",
            "Entity": "Неверная сущность",
            "not defined": "не определена",
            "Specification mandates value": "Значение атрибута должно быть в кавычках",
            "Couldn't find end of Start Tag": "Не найдено окончание открывающего тега",
            "StartTag: invalid element name": "Некорректное имя элемента в открывающем теге",
            "xmlParseEntityRef: no name": "Ошибка в спецсимволе (&) - используйте &amp; вместо &",
            "AttValue": "Ошибка в значении атрибута",
            "Char 0x0 out of allowed range": "Недопустимый символ (нулевой байт)",
        }
        
        # Специальная обработка ошибок с амперсандом (EntityRef, Entity и т.д.)
        error_lower = error_msg.lower()
        if ("entityref" in error_lower or "entity" in error_lower) and ("expecting" in error_lower or ";" in error_lower or "no name" in error_lower):
            return "Неэкранированный амперсанд (&) - замените & на &amp;"
        if "Entity" in error_msg or "entity" in error_msg.lower() or ("&" in error_msg and ("expecting" in error_lower or ";" in error_lower)):
            if "no name" in error_lower or "not defined" in error_lower or "expecting" in error_lower:
                return "Неэкранированный амперсанд (&) - замените & на &amp;"
            return "Неверная XML-сущность (проблема с амперсандом &) - замените & на &amp;"
        
        for eng, rus in translations.items():
            if eng.lower() in error_msg.lower():
                return rus
        
        return error_msg
    
    def check_xml_syntax(self) -> Dict:
        """Проверка синтаксиса XML с подробной информацией об ошибках"""
        try:
            content_str = None
            all_errors = []  # Собираем все ошибки
            
            if self.file_content:
                content_str = self.file_content.decode('utf-8', errors='replace')
                # Пробуем парсить с recover=True для поиска всех ошибок
                parser = etree.XMLParser(recover=True)
                try:
                    etree.fromstring(self.file_content, parser=parser)
                except etree.XMLSyntaxError:
                    pass  # Ошибки будут в error_log
                
                # Собираем все ошибки из error_log
                if parser.error_log:
                    for error_entry in parser.error_log:
                        all_errors.append({
                            "line": error_entry.line,
                            "column": error_entry.column,
                            "message": str(error_entry.message)
                        })
                
                # Если есть ошибки, пробуем без recover для получения первой детальной ошибки
                if all_errors:
                    etree.fromstring(self.file_content)  # Это вызовет исключение с деталями
            else:
                site_data = self.get_url_text()
                content_str = site_data
                
                # Логируем начало содержимого для отладки
                logger.info(f"📋 Content preview (first 500 chars): {content_str[:500]}")
                logger.info(f"📏 Content length: {len(content_str)} characters")
                logger.info(f"🔤 First 50 bytes (hex): {content_str[:50].encode('utf-8').hex()}")
                
                # Проверяем, не пустой ли файл
                if not content_str or not content_str.strip():
                    raise FeedDownloadError(
                        message="Получен пустой ответ от сервера",
                        error_code="EMPTY_RESPONSE",
                        url=self.site_url if hasattr(self, 'site_url') else None,
                        details={
                            "error_type": "EmptyResponse",
                            "suggestion": "Проверьте URL фида. Возможно, сервер не вернул данные."
                        }
                    )
                
                # Проверяем, начинается ли с '<'
                stripped = content_str.strip()
                if not stripped.startswith('<'):
                    logger.error(f"❌ Content does not start with '<'. First 100 chars: {repr(stripped[:100])}")
                    # Пытаемся определить, что это
                    if stripped.startswith('<!doctype') or stripped.lower().startswith('<html'):
                        raise FeedDownloadError(
                            message="Сервер вернул HTML страницу вместо XML фида",
                            error_code="INVALID_CONTENT_TYPE",
                            url=self.site_url if hasattr(self, 'site_url') else None,
                            details={
                                "error_type": "HTMLResponse",
                                "content_preview": stripped[:500],
                                "suggestion": "Проверьте URL фида. Возможно, требуется авторизация или специальные заголовки."
                            }
                        )
                    else:
                        raise FeedDownloadError(
                            message=f"Неожиданный формат ответа. Ожидается XML, начинающийся с '<', получено: {repr(stripped[:50])}",
                            error_code="INVALID_FORMAT",
                            url=self.site_url if hasattr(self, 'site_url') else None,
                            details={
                                "error_type": "InvalidFormat",
                                "content_preview": stripped[:500],
                                "suggestion": "Проверьте URL фида. Возможно, сервер возвращает данные в неожиданном формате."
                            }
                        )
                
                # Определяем кодировку
                if 'UTF-8' in site_data or 'utf-8' in site_data:
                    encoding = 'utf-8'
                elif 'windows-1251' in site_data:
                    encoding = 'cp1251'
                else:
                    encoding = 'utf-8'
                
                xml_bytes = bytes(site_data, encoding=encoding)
                
                # Пробуем парсить с recover=True для поиска всех ошибок
                parser = etree.XMLParser(recover=True)
                try:
                    etree.fromstring(xml_bytes, parser=parser)
                except etree.XMLSyntaxError:
                    pass  # Ошибки будут в error_log
                
                # Собираем все ошибки из error_log
                if parser.error_log:
                    for error_entry in parser.error_log:
                        all_errors.append({
                            "line": error_entry.line,
                            "column": error_entry.column,
                            "message": str(error_entry.message)
                        })
                
                # Если есть ошибки, пробуем без recover для получения первой детальной ошибки
                if all_errors:
                    etree.fromstring(xml_bytes)  # Это вызовет исключение с деталями
            
            # Если дошли сюда без ошибок
            if not all_errors:
                return {
                    "valid": True, 
                    "message": "XML корректен, синтаксических ошибок не найдено",
                    "human_message": "✅ Файл валиден"
                }
            
        except etree.XMLSyntaxError as err:
            logging.error(f"XML Syntax Error: {err}")
            
            # Проверяем, не HTML ли это
            if content_str:
                content_lower = content_str[:500].strip().lower()
                is_html_response = (
                    content_lower.startswith('<!doctype') or 
                    content_lower.startswith('<html') or 
                    '<body' in content_lower[:200]
                )
                
                if is_html_response:
                    # Это HTML, а не XML
                    logger.error(f"❌ Server returned HTML instead of XML feed")
                    
                    # Пытаемся извлечь информацию об ошибке из HTML
                    error_info = "Неизвестная ошибка"
                    import re
                    # Ищем title
                    error_match = re.search(r'<title[^>]*>(.*?)</title>', content_str[:1000], re.IGNORECASE | re.DOTALL)
                    if error_match:
                        error_info = error_match.group(1).strip()[:100]
                    # Ищем сообщения об ошибках
                    if not error_info or error_info == "Неизвестная ошибка":
                        error_match = re.search(r'<h1[^>]*>(.*?)</h1>', content_str[:1000], re.IGNORECASE | re.DOTALL)
                        if error_match:
                            error_info = error_match.group(1).strip()[:100]
                    
                    # Проверяем, может быть это страница с редиректом или требует JavaScript
                    requires_js = 'javascript' in content_lower or 'script' in content_lower[:500]
                    has_redirect = 'location' in content_lower or 'redirect' in content_lower[:500]
                    
                    suggestion = "Сервер вернул HTML страницу вместо XML фида. Возможно, требуется авторизация или специальные заголовки."
                    if requires_js:
                        suggestion += " Сервер может требовать выполнения JavaScript."
                    if has_redirect:
                        suggestion += " Обнаружен редирект."
                    
                    raise FeedDownloadError(
                        message="Сервер вернул HTML страницу вместо XML фида. Возможно, требуется авторизация или URL неверен.",
                        error_code="INVALID_CONTENT_TYPE",
                        url=self.site_url if hasattr(self, 'site_url') else None,
                        details={
                            "error_type": "HTMLResponse",
                            "content_preview": content_str[:500],
                            "html_error": error_info,
                            "requires_javascript": requires_js,
                            "has_redirect": has_redirect,
                            "suggestion": suggestion
                        }
                    )
            
            # Собираем все ошибки из error_log, если они еще не собраны
            if not all_errors:
                error_log = err.error_log
                if error_log:
                    for error_entry in error_log:
                        all_errors.append({
                            "line": error_entry.line,
                            "column": error_entry.column,
                            "message": str(error_entry.message)
                        })
            
            # Если ошибки не собраны, используем информацию из исключения
            if not all_errors:
                error_log = err.error_log
                error_entry = error_log[0] if error_log else None
                if error_entry:
                    all_errors.append({
                        "line": error_entry.line,
                        "column": error_entry.column,
                        "message": str(error_entry.message)
                    })
            
            # Обрабатываем первую ошибку детально
            first_error = all_errors[0] if all_errors else {}
            line_num = first_error.get("line", 0)
            column = first_error.get("column", 0)
            error_msg = first_error.get("message", str(err))
            
            # Получаем контекст ошибки
            context_info = {}
            if content_str and line_num > 0:
                context_info = self._get_error_context(content_str, line_num)
            
            # Переводим ошибку на русский
            human_message = self._translate_xml_error(error_msg)
            
            # Получаем полную строку с ошибкой
            error_line_full = ""
            if content_str and line_num > 0:
                lines = content_str.split('\n')
                if 0 < line_num <= len(lines):
                    error_line_full = lines[line_num - 1]
            
            # Проверяем, есть ли в строке неэкранированный амперсанд
            # Также проверяем само сообщение об ошибке - если это EntityRef, то точно амперсанд
            is_entity_ref_error = "EntityRef" in error_msg or "entityref" in error_msg.lower() or ("entity" in error_msg.lower() and "expecting" in error_msg.lower())
            has_ampersand, ampersand_hint = self._check_unescaped_ampersand(error_line_full, column)
            
            # Если ошибка связана с EntityRef, но проверка не нашла амперсанд, все равно помечаем как амперсанд
            if is_entity_ref_error and not has_ampersand:
                has_ampersand = True
                ampersand_hint = " Обнаружен неэкранированный амперсанд (&) - замените на &amp;"
                logger.info(f"🔍 EntityRef error detected, marking as ampersand error. Line: {line_num}, Column: {column}")
            elif has_ampersand:
                ampersand_hint = f" {ampersand_hint}"
                logger.info(f"🔍 Ampersand detected in line. Line: {line_num}, Column: {column}")
            else:
                ampersand_hint = ""
            
            logger.info(f"📊 Error processing: line={line_num}, column={column}, has_ampersand={has_ampersand}, is_entity_ref={is_entity_ref_error}, error_msg={error_msg[:100]}")
            
            # Обрезаем длинную строку, если нужно
            line_info = self._truncate_line_with_context(error_line_full, column if column > 0 else 0)
            error_line_display = line_info["preview"] if line_info["truncated"] else error_line_full
            
            # Формируем детальные сообщения для всех ошибок
            detailed_errors = []
            for error in all_errors:
                err_line = error.get("line", 0)
                err_col = error.get("column", 0)
                err_msg = error.get("message", "")
                
                # Получаем полную строку для этой ошибки
                err_line_full = ""
                if content_str and err_line > 0:
                    lines = content_str.split('\n')
                    if 0 < err_line <= len(lines):
                        err_line_full = lines[err_line - 1]
                
                # Проверяем амперсанд
                # Также проверяем само сообщение об ошибке - если это EntityRef, то точно амперсанд
                is_entity_ref = "EntityRef" in err_msg or "entityref" in err_msg.lower() or ("entity" in err_msg.lower() and "expecting" in err_msg.lower())
                has_amp, err_ampersand_hint = self._check_unescaped_ampersand(err_line_full, err_col)
                
                # Если ошибка связана с EntityRef, но проверка не нашла амперсанд, все равно помечаем как амперсанд
                if is_entity_ref and not has_amp:
                    has_amp = True
                    err_ampersand_hint = " Обнаружен неэкранированный амперсанд (&) - замените на &amp;"
                elif has_amp:
                    err_ampersand_hint = f" {err_ampersand_hint}"
                else:
                    err_ampersand_hint = ""
                
                # Обрезаем длинную строку, если нужно
                err_line_info = self._truncate_line_with_context(err_line_full, err_col if err_col > 0 else 0)
                err_line_display = err_line_info["preview"] if err_line_info["truncated"] else err_line_full
                
                translated = self._translate_xml_error(err_msg)
                if err_line > 0:
                    if err_line_display:
                        detailed_msg = f"Строка {err_line}, позиция {err_col}: {translated}{err_ampersand_hint}\nПроблемная строка: {err_line_display}"
                        if err_line_info["truncated"]:
                            detailed_msg += f"\n(Строка обрезана, полная длина: {err_line_info['line_length']} символов)"
                    else:
                        detailed_msg = f"Строка {err_line}, позиция {err_col}: {translated}{err_ampersand_hint}"
                else:
                    detailed_msg = f"{translated}{err_ampersand_hint}"
                
                detailed_errors.append({
                    "line": err_line,
                    "column": err_col,
                    "message": err_msg,
                    "translated_message": translated,
                    "full_line": err_line_full,
                    "display_line": err_line_display,  # Обрезанная версия для отображения
                    "is_truncated": err_line_info["truncated"],
                    "line_length": err_line_info.get("line_length", len(err_line_full)),
                    "has_ampersand": has_amp,
                    "detailed_message": detailed_msg
                })
            
            # Формируем понятное описание с обрезанной строкой для первой ошибки
            if line_num > 0:
                if error_line_display:
                    detailed_message = f"Строка {line_num}, позиция {column}: {human_message}{ampersand_hint}\nПроблемная строка: {error_line_display}"
                    if line_info["truncated"]:
                        detailed_message += f"\n(Строка обрезана, полная длина: {line_info['line_length']} символов)"
                else:
                    detailed_message = f"Строка {line_num}, позиция {column}: {human_message}{ampersand_hint}"
            else:
                detailed_message = f"{human_message}{ampersand_hint}"
            
            # Если найдено несколько ошибок, добавляем информацию
            if len(all_errors) > 1:
                detailed_message += f"\n\nВсего найдено XML ошибок: {len(all_errors)}"
            
            return {
                "valid": False,
                "error_code": "XML_SYNTAX_ERROR",
                "message": str(err),  # Оригинальная техническая ошибка
                "human_message": detailed_message,  # Понятное описание
                "line": line_num,
                "column": column,
                "error_text": error_msg,
                "translated_error": human_message,
                "full_line": error_line_full,  # Полная строка с ошибкой
                "display_line": error_line_display,  # Обрезанная версия для отображения
                "is_truncated": line_info["truncated"],
                "line_length": line_info.get("line_length", len(error_line_full)),
                "has_ampersand": has_ampersand,
                "all_errors": detailed_errors,  # Все ошибки с деталями
                "errors_count": len(all_errors),
                **context_info  # Добавляем error_line и context если есть
            }
            
        except (FeedDownloadError, FeedValidationError):
            # Пробрасываем наши кастомные исключения дальше
            raise
        except Exception as e:
            logging.error(f"Unknown error: {e}")
            return {
                "valid": False,
                "error_code": "UNKNOWN_ERROR",
                "message": str(e),
                "human_message": f"Неизвестная ошибка при разборе XML: {str(e)}"
            }

    def get_tree_object(self):
        """Парсинг XML в дерево"""
        try:
            if self.file_content:
                logger.info(f"📦 Parsing XML from file_content: {len(self.file_content) / 1024 / 1024:.2f} MB")
                # НЕ сохраняем весь XML в память - используем только для парсинга
                self.feed_tree = etree.fromstring(self.file_content)
            else:
                site_data = self.get_url_text()
                logger.info(f"📦 Parsing XML from site_data: {len(site_data) / 1024 / 1024:.2f} MB ({len(site_data)} characters)")
                
                # Определяем кодировку
                if 'UTF-8' in site_data or 'utf-8' in site_data:
                    encoding = 'utf-8'
                elif 'windows-1251' in site_data:
                    encoding = 'cp1251'
                else:
                    encoding = 'utf-8'
                
                logger.info(f"🔄 Converting to bytes with encoding: {encoding}")
                xml_bytes = bytes(site_data, encoding=encoding)
                logger.info(f"📦 XML bytes size: {len(xml_bytes) / 1024 / 1024:.2f} MB")
                
                # Освобождаем site_data сразу после конвертации
                del site_data
                logger.info(f"🗑️ Freed site_data from memory")
                
                logger.info(f"🌳 Starting XML parsing (this may take a while for large files)...")
                logger.info(f"⏱️ Parsing started at: {datetime.now().isoformat()}")
                
                # Используем BytesIO для более эффективного парсинга
                from io import BytesIO
                xml_buffer = BytesIO(xml_bytes)
                self.feed_tree = etree.parse(xml_buffer).getroot()
                xml_buffer.close()
                
                # Освобождаем память после парсинга
                del xml_bytes
                logger.info(f"🗑️ Freed xml_bytes from memory")
                
                logger.info(f"✅ XML parsing successful!")
                logger.info(f"⏱️ Parsing completed at: {datetime.now().isoformat()}")
            
            logger.info(f"🔧 Running check_spelling...")
            self.check_spelling()
            logger.info(f"✅ check_spelling completed")
        except MemoryError as e:
            logger.error(f"❌ Memory error during XML parsing: {e}")
            logger.error(f"❌ File size: {len(self.file_content) / 1024 / 1024:.2f} MB" if self.file_content else "❌ Site data size: large")
            raise FeedValidationError(
                message="Недостаточно памяти для парсинга XML файла. Файл слишком большой.",
                validation_results={
                    "parsing_error": True,
                    "error_type": "MemoryError",
                    "error_message": str(e),
                    "suggestion": "Увеличьте лимиты памяти в Kubernetes или используйте более легкий формат фида"
                }
            )
        except Exception as e:
            logger.error(f"❌ Error parsing XML tree: {e}")
            logger.error(f"❌ Error type: {type(e).__name__}")
            import traceback
            logger.error(f"❌ Traceback: {traceback.format_exc()}")
            raise

    def check_spelling(self):
        """Исправление ошибок написания тегов"""
        for cat_id in self.feed_tree.iter('categoryid'):
            cat_id.tag = 'categoryId'
        
        cats_with_parents = [
            category for category in self.feed_tree.iter('category') 
            if 'parentid' in category.attrib
        ]
        
        for elem in cats_with_parents:
            elem.attrib['parentId'] = elem.attrib['parentid']
            del elem.attrib['parentid']

    def calculate_category_tree_depth(self):
        """Расчет глубины дерева категорий"""
        category_hierarchy = {}
        for category in self.site_categories:
            category_id = category.attrib.get('id')
            parent_id = category.attrib.get('parentId', None)
            if parent_id:
                if parent_id not in category_hierarchy:
                    category_hierarchy[parent_id] = []
                category_hierarchy[parent_id].append(category_id)

        def calculate_depth(node_id, depth=1):
            if node_id not in category_hierarchy:
                return depth
            else:
                return max(calculate_depth(child_id, depth + 1) for child_id in category_hierarchy[node_id])

        root_categories = [
            category.attrib['id'] for category in self.site_categories 
            if 'parentId' not in category.attrib
        ]
        
        try:
            max_depth = max(calculate_depth(root_id) for root_id in root_categories) if root_categories else 0
        except:
            max_depth = -1

        return max_depth

    def get_mandatory_requirements(self):
        """Основная проверка обязательных требований"""
        self.site_offers = [elem for elem in self.feed_tree.iter('offer')]
        self.site_categories = [elem for elem in self.feed_tree.iter('category')]

        self.categories_full_info = [
            (category.attrib['id'], category.text, category.attrib.get('parentId', '')) 
            for category in self.site_categories
        ]

        self.categories_ids = [category[0] for category in self.categories_full_info]
        self.categories_names = [category[1] for category in self.categories_full_info]

        offer_ids = []
        
        for offer in self.site_offers:
            offer_id_val = offer.attrib.get('id')
            
            # Проверка available
            if 'available' in offer.attrib:
                if offer.attrib['available'] == 'true':
                    self.available_offers_count += 1
                elif offer.attrib['available'] == 'false':
                    self.unavailable_offers_count += 1
                else:
                    self.empty_availability_count += 1
                    self.offers_without_availability.append(offer)
            else:
                self.empty_availability_count += 1
                self.offers_without_availability.append(offer)

            # Проверка ID
            if offer_id_val and offer_id_val.strip():
                offer_ids.append(offer_id_val.strip())
            else:
                self.offers_without_id.append(offer)

            # Проверка name
            name = offer.find('name')
            name_text = name.text.strip() if name is not None and name.text else None
            if not name_text:
                type_prefix = offer.find('typePrefix')
                vendor_elem = offer.find('vendor')
                model = offer.find('model')
                type_prefix_text = type_prefix.text.strip() if type_prefix is not None and type_prefix.text else None
                vendor_text = vendor_elem.text.strip() if vendor_elem is not None and vendor_elem.text else None
                model_text = model.text.strip() if model is not None and model.text else None

                if not (type_prefix_text and vendor_text and model_text):
                    self.offers_without_name.append(offer)

            # Проверка vendor
            vendor_elem = offer.find('vendor')
            vendor_text = vendor_elem.text.strip() if vendor_elem is not None and vendor_elem.text else ''
            if vendor_text:
                self.brands.add(vendor_text)

            # Проверка url
            url = offer.find('url')
            url_text = url.text.strip() if url is not None and url.text else None
            if not url_text:
                self.offers_without_link.append(offer)

            # Проверка price
            price = offer.find('price')
            price_text = price.text.strip() if price is not None and price.text else None
            if not price_text:
                self.offers_price_issues.append(offer)
            else:
                try:
                    price_value = float(price_text)
                    if price_value <= 0:
                        self.offers_price_issues.append(offer)
                except ValueError:
                    self.offers_price_issues.append(offer)

            # Проверка categoryId
            categories_parent = offer.find('categories')
            categories = []
            if categories_parent is not None:
                for cat in categories_parent.findall('categoryId'):
                    cat_text = cat.text.strip() if cat is not None and cat.text else None
                    if cat_text:
                        categories.append(cat_text)
            else:
                top_level_cats = offer.findall('categoryId')
                if top_level_cats:
                    for cat in top_level_cats:
                        cat_text = cat.text.strip() if cat is not None and cat.text else None
                        if cat_text:
                            categories.append(cat_text)

            if not categories:
                self.offers_without_category.append(offer)
            else:
                for cat in categories:
                    if cat not in self.categories_ids:
                        if offer not in self.offers_invalid_category:
                            self.offers_invalid_category.append(offer)

                if len(categories) > 1 and categories_parent is None:
                    self.offers_multiple_categories.append(offer)

            # Проверка vendor
            bad_vendor_values = {"null", "без бренда", "нет", "не указан", "unknown", "n/a", ""}
            if vendor_text.lower() in bad_vendor_values:
                self.offers_vendor_issues.append(offer)

            # Проверка picture
            picture = offer.find('picture')
            picture_text = picture.text.strip() if picture is not None and picture.text else None
            if not picture_text:
                self.offers_without_image.append(offer)

        # Проверка дубликатов ID
        ids_count = dict(Counter(offer_ids))
        for iD, count in ids_count.items():
            if count > 1:
                self.duplicate_ids.append((iD, count))

        # Глубина дерева категорий
        category_tree_depth = self.calculate_category_tree_depth()

        return {
            "total_offers": len(self.site_offers),
            "available_offers": self.available_offers_count,
            "unavailable_offers": self.unavailable_offers_count,
            "total_categories": len(self.site_categories),
            "category_tree_depth": category_tree_depth,
            "brands_count": len(self.brands),
            "problems": {
                "missing_id": len(self.offers_without_id),
                "missing_availability": self.empty_availability_count,
                "missing_name": len(self.offers_without_name),
                "missing_link": len(self.offers_without_link),
                "price_issues": len(self.offers_price_issues),
                "missing_category": len(self.offers_without_category),
                "invalid_category": len(self.offers_invalid_category),
                "multiple_categories": len(self.offers_multiple_categories),
                "vendor_issues": len(self.offers_vendor_issues),
                "missing_image": len(self.offers_without_image),
            },
            "duplicate_ids": self.duplicate_ids,
        }

    def check_category_issues(self):
        """Проверка проблем с категориями"""
        all_offers_categories = [
            category.text for offer in self.site_offers 
            for category in offer.iter('categoryId') 
            if len(list(offer.iter('categoryId'))) != 0 and category.text != ''
        ]
        
        all_parents_categories = [
            category.attrib['parentId'] for category in self.site_categories 
            if 'parentId' in category.attrib
        ]
        
        feed_categories = list(set(all_offers_categories)) + list(set(all_parents_categories))

        # Пустые категории
        self.empty_categories = [
            (category.attrib['id'], category.text) for category in self.site_categories 
            if category.attrib['id'] not in feed_categories
        ]

        # Дубликаты категорий
        categories_ids_names = [(category.attrib['id'], category.text) for category in self.site_categories]
        categories_names = [category.text for category in self.site_categories]
        categories_dict = Counter(categories_names)

        self.duplicated_cats = []
        for key, values in categories_dict.items():
            if values > 1:
                for elem in categories_ids_names:
                    if key == elem[1]:
                        self.duplicated_cats.append((elem[0], key))

        # Сдвоенные категории
        long_categories = [
            (category_id, category_name) for category_id, category_name 
            in zip(self.categories_ids, self.categories_names)
            if category_name and (len([cword.strip() for cword in category_name.split()]) > 1)
        ]

        self.dual_categories = [
            (ID, name) for ID, name in long_categories for word in name.split()
            if re.search(r'[,/;&]', word) or word.lower() in {'и', 'and'}
        ]

        self.dual_categories = list(set(self.dual_categories))

        return {
            "empty_categories": self.empty_categories,
            "duplicated_categories": self.duplicated_cats,
            "dual_categories": self.dual_categories,
        }

    def get_offer_details(self, offer):
        """Получение деталей товара"""
        offer_id = offer.attrib.get('id', 'Отсутствует ID')
        name_elem = offer.find('name')
        offer_name = name_elem.text.strip() if name_elem is not None and name_elem.text else 'Без названия'
        url_elem = offer.find('url')
        offer_url = url_elem.text.strip() if url_elem is not None and url_elem.text else 'Ссылка отсутствует'
        price_elem = offer.find('price')
        offer_price = price_elem.text.strip() if price_elem is not None and price_elem.text else 'Цена отсутствует'

        # Получаем бренд (vendor)
        vendor_elem = offer.find('vendor')
        vendor = vendor_elem.text.strip() if vendor_elem is not None and vendor_elem.text else 'Бренд не указан'

        # Получаем категории
        categories = []
        categories_parent = offer.find('categories')
        if categories_parent is not None:
            for cat in categories_parent.findall('categoryId'):
                cat_text = cat.text.strip() if cat is not None and cat.text else None
                if cat_text:
                    categories.append(cat_text)
        else:
            top_level_cats = offer.findall('categoryId')
            if top_level_cats:
                for cat in top_level_cats:
                    cat_text = cat.text.strip() if cat is not None and cat.text else None
                    if cat_text:
                        categories.append(cat_text)

        category_display = ', '.join(categories) if categories else 'Категория не указана'

        return {
            "id": offer_id,
            "name": offer_name,
            "url": offer_url,
            "price": offer_price,
            "vendor": vendor,
            "categories": category_display,
        }

    def get_problematic_offers(self, problem_type: ProblemType):
        """Получение списка проблемных товаров по типу"""
        problem_mapping = {
            ProblemType.MISSING_ID: self.offers_without_id,
            ProblemType.MISSING_AVAILABLE: self.offers_without_availability,
            ProblemType.MISSING_NAME: self.offers_without_name,
            ProblemType.MISSING_LINK: self.offers_without_link,
            ProblemType.PRICE_ISSUES: self.offers_price_issues,
            ProblemType.MISSING_CATEGORY: self.offers_without_category,
            ProblemType.INVALID_CATEGORY: self.offers_invalid_category,
            ProblemType.MULTIPLE_CATEGORIES: self.offers_multiple_categories,
            ProblemType.MISSING_VENDOR: self.offers_vendor_issues,
            ProblemType.MISSING_IMAGE: self.offers_without_image,
        }
        
        offers = problem_mapping.get(problem_type, [])
        return [self.get_offer_details(offer) for offer in offers]

    def build_category_tree(self):
        """Построение дерева категорий с проверкой несуществующих родителей"""
        tree = []
        orphaned_categories = []
        
        # Создаем словарь для быстрого доступа к категориям
        categories_dict = {}
        for cat_id, cat_name, parent_id in self.categories_full_info:
            categories_dict[cat_id] = {
                "id": cat_id,
                "name": cat_name,
                "parent_id": parent_id,
                "children": [],
            }
        
        # Строим дерево и находим категории с несуществующими родителями
        root_categories = []
        for cat_id, cat_info in categories_dict.items():
            parent_id = cat_info["parent_id"]
            
            if not parent_id:
                # Корневая категория
                root_categories.append(cat_info)
            elif parent_id in categories_dict:
                # Добавляем как дочернюю к родительской
                categories_dict[parent_id]["children"].append(cat_info)
            else:
                # Родитель не существует
                orphaned_categories.append({
                    "id": cat_id,
                    "name": cat_info["name"],
                    "missing_parent_id": parent_id,
                })
        
        return {
            "tree": root_categories,
            "orphaned_categories": orphaned_categories,
            "total_categories": len(self.categories_full_info),
        }
    
    def validate_params(self):
        """
        Валидация тегов <param> - проверка наличия обязательного атрибута name
        и проверка на дубликаты параметров с одинаковым именем (игнорируя unit)
        Возвращает список ошибок с номерами строк и полными строками
        Проверяет распарсенное дерево - это самый надежный способ
        """
        errors = []
        duplicate_errors = []
        
        # Проверяем распарсенное дерево (основной способ - самый надежный)
        if self.feed_tree is not None:
            total_params_checked = 0
            invalid_params_found = 0
            
            logger.info(f"🌳 Checking feed_tree for param tags...")
            
            offer_count = 0
            for offer in self.feed_tree.iter('offer'):
                offer_count += 1
                try:
                    params = offer.findall('.//param')
                    total_params_checked += len(params)
                    
                    if offer_count % 1000 == 0:
                        logger.info(f"  Processed {offer_count} offers, found {len(errors)} missing name errors, {len(duplicate_errors)} duplicate errors so far...")
                    
                    # Словарь для отслеживания параметров по имени и значению (игнорируя unit)
                    # Структура: {param_name: {param_value: [list of param elements]}}
                    param_names_seen = {}
                    
                    for param in params:
                        # Проверяем наличие атрибута name
                        # param.attrib - это словарь атрибутов
                        has_name_attr = 'name' in param.attrib
                        param_name = param.attrib.get('name', '').strip() if has_name_attr else ''
                        
                        # Логируем первые несколько для отладки
                        if total_params_checked <= 10:
                            param_xml = etree.tostring(param, encoding='unicode', pretty_print=False).strip()
                            logger.info(f"  Param #{total_params_checked}: has_name={has_name_attr}, name='{param_name}', xml={param_xml[:150]}")
                        
                        # КРИТИЧЕСКАЯ ПРОВЕРКА: если нет атрибута name или он пустой - это ошибка
                        if not param_name:
                            invalid_params_found += 1
                            # Используем sourceline из lxml для номера строки (если доступен)
                            line_num = None
                            if hasattr(param, 'sourceline') and param.sourceline:
                                line_num = param.sourceline
                            
                            param_xml = etree.tostring(param, encoding='unicode', pretty_print=False).strip()
                            
                            error_info = {
                                "error": "Тег <param> без атрибута name или с пустым name",
                                "param_content": param_xml,
                            }
                            if line_num:
                                error_info["line_number"] = line_num
                                error_info["full_line"] = param_xml
                                error_info["message"] = f"Строка {line_num}: Тег <param> без атрибута name или с пустым name"
                            else:
                                error_info["message"] = "Тег <param> без атрибута name или с пустым name"
                                error_info["full_line"] = param_xml
                            errors.append(error_info)
                        else:
                            # Параметр с валидным именем - получаем значение (игнорируя unit)
                            param_value = (param.text or '').strip()
                            
                            # Группируем по имени и значению (unit игнорируем)
                            if param_name not in param_names_seen:
                                param_names_seen[param_name] = {}
                            
                            if param_value not in param_names_seen[param_name]:
                                param_names_seen[param_name][param_value] = []
                            
                            param_names_seen[param_name][param_value].append(param)
                    
                    # Проверяем дубликаты для этого offer
                    # Дубликат = одинаковое имя + одинаковое значение (unit игнорируем)
                    for param_name, value_groups in param_names_seen.items():
                        for param_value, param_list in value_groups.items():
                            if len(param_list) > 1:
                                # Найден дубликат - одинаковое имя и значение (игнорируя unit)
                                # Создаем ошибку для каждого дубликата (кроме первого)
                                for i, duplicate_param in enumerate(param_list[1:], 1):
                                    line_num = None
                                    if hasattr(duplicate_param, 'sourceline') and duplicate_param.sourceline:
                                        line_num = duplicate_param.sourceline
                                    
                                    param_xml = etree.tostring(duplicate_param, encoding='unicode', pretty_print=False).strip()
                                    
                                    # Получаем все дубликаты для отображения
                                    all_duplicates = []
                                    for dup_param in param_list:
                                        dup_line = dup_param.sourceline if hasattr(dup_param, 'sourceline') and dup_param.sourceline else None
                                        dup_xml = etree.tostring(dup_param, encoding='unicode', pretty_print=False).strip()
                                        dup_unit = dup_param.attrib.get('unit', '').strip()
                                        all_duplicates.append({
                                            "line_number": dup_line,
                                            "full_line": dup_xml,
                                            "unit": dup_unit if dup_unit else None
                                        })
                                    
                                    # Формируем описание с учетом unit (если есть)
                                    units_info = []
                                    for dup_param in param_list:
                                        dup_unit = dup_param.attrib.get('unit', '').strip()
                                        if dup_unit:
                                            units_info.append(dup_unit)
                                    
                                    if units_info:
                                        unique_units = list(set(units_info))
                                        if len(unique_units) > 1:
                                            units_str = f" (с разными unit: {', '.join(unique_units)})"
                                        elif len(unique_units) == 1:
                                            units_str = f" (unit=\"{unique_units[0]}\")"
                                        else:
                                            units_str = ""
                                    else:
                                        units_str = ""
                                    
                                    error_info = {
                                        "error": f"Дубликат параметра '{param_name}' со значением '{param_value}' (игнорируя unit)",
                                        "param_name": param_name,
                                        "param_value": param_value,
                                        "param_content": param_xml,
                                        "duplicate_count": len(param_list),
                                        "all_duplicates": all_duplicates,
                                    }
                                    if line_num:
                                        error_info["line_number"] = line_num
                                        error_info["full_line"] = param_xml
                                        error_info["message"] = f"Строка {line_num}: Дубликат параметра '{param_name}' со значением '{param_value}'{units_str} (найдено {len(param_list)} раз)"
                                    else:
                                        error_info["message"] = f"Дубликат параметра '{param_name}' со значением '{param_value}'{units_str} (найдено {len(param_list)} раз)"
                                        error_info["full_line"] = param_xml
                                    duplicate_errors.append(error_info)
                except Exception as e:
                    # Если произошла ошибка при обработке одного offer, логируем и продолжаем
                    logger.warning(f"⚠️ Error processing offer params: {e}", exc_info=True)
                    continue
            
            logger.info(f"📊 Validated {total_params_checked} param tags in {offer_count} offers, found {invalid_params_found} invalid, {len(duplicate_errors)} duplicates")
            
            # Объединяем все ошибки (отсутствие name и дубликаты)
            all_errors = errors + duplicate_errors
            
            if all_errors:
                logger.warning(f"⚠️ Found {len(errors)} missing name errors and {len(duplicate_errors)} duplicate errors")
                logger.warning(f"⚠️ Total errors collected: {len(all_errors)}")
                if errors:
                    logger.warning(f"   First missing name error: {errors[0].get('message', 'N/A')}")
                if duplicate_errors:
                    logger.warning(f"   First duplicate error: {duplicate_errors[0].get('message', 'N/A')}")
                    logger.warning(f"   Last duplicate error: {duplicate_errors[-1].get('message', 'N/A') if duplicate_errors else 'N/A'}")
            else:
                logger.info(f"✅ All {total_params_checked} param tags have valid name attribute and no duplicates")
            
            # Возвращаем все ошибки вместе (не останавливаем проверку)
            logger.info(f"🔍 Returning {len(all_errors)} total errors from validate_params")
            return all_errors
        
        return errors
    
    def analyze_parameters(self):
        """Анализ параметров товаров"""
        total_params = 0
        offers_with_params = 0
        offers_without_params = 0
        
        for offer in self.site_offers:
            params = offer.findall('.//param')
            param_count = len(params)
            
            total_params += param_count
            
            if param_count > 0:
                offers_with_params += 1
            else:
                offers_without_params += 1
        
        total_offers = len(self.site_offers)
        avg_params = total_params / total_offers if total_offers > 0 else 0
        
        has_warning = offers_without_params > 0
        
        return {
            "total_params": total_params,
            "total_offers": total_offers,
            "avg_params_per_offer": round(avg_params, 2),
            "offers_with_params": offers_with_params,
            "offers_without_params": offers_without_params,
            "has_no_params_warning": has_warning,
        }
    
    def analyze_attributes(self):
        """Анализ всех атрибутов и параметров в фиде"""
        # Анализ param элементов
        param_analysis = defaultdict(lambda: {"count": 0, "values": Counter()})
        
        for offer in self.site_offers:
            params = offer.findall('.//param')
            for param in params:
                param_name = param.attrib.get('name', '').strip()
                
                # Пропускаем параметры без name - они уже должны быть отловлены валидацией
                # Но на всякий случай проверяем и логируем предупреждение
                if not param_name:
                    logger.warning(f"⚠️ Found param without name in analyze_attributes (should have been caught by validation)")
                    continue
                
                param_value = param.text or ''
                param_unit = param.attrib.get('unit', '')
                
                # Формируем полное значение с единицей измерения если есть
                full_value = f"{param_value} {param_unit}".strip() if param_unit else param_value
                
                param_analysis[param_name]["count"] += 1
                param_analysis[param_name]["values"][full_value] += 1
        
        # Анализ тегов offer (не параметров)
        offer_tags_analysis = defaultdict(lambda: {"count": 0, "values": Counter()})
        
        # Список интересующих тегов
        interesting_tags = [
            'vendor', 'model', 'vendorCode', 'barcode', 'country_of_origin',
            'delivery', 'pickup', 'store', 'manufacturer_warranty',
            'age', 'weight', 'dimensions', 'sales_notes',
        ]
        
        for offer in self.site_offers:
            for tag_name in interesting_tags:
                tag_elements = offer.findall(f'.//{tag_name}')
                for tag_elem in tag_elements:
                    tag_value = tag_elem.text or ''
                    if tag_value:
                        offer_tags_analysis[tag_name]["count"] += 1
                        offer_tags_analysis[tag_name]["values"][tag_value] += 1
        
        # Форматируем результаты для param
        formatted_params = []
        for param_name, data in sorted(param_analysis.items(), key=lambda x: x[1]["count"], reverse=True):
            # Берем топ-10 самых частых значений
            top_values = data["values"].most_common(10)
            formatted_params.append({
                "name": param_name,
                "total_count": data["count"],
                "unique_values_count": len(data["values"]),
                "top_values": [{"value": v, "count": c} for v, c in top_values],
            })
        
        # Форматируем результаты для тегов
        formatted_tags = []
        for tag_name, data in sorted(offer_tags_analysis.items(), key=lambda x: x[1]["count"], reverse=True):
            if data["count"] > 0:  # Только теги которые есть в фиде
                top_values = data["values"].most_common(10)
                formatted_tags.append({
                    "name": tag_name,
                    "total_count": data["count"],
                    "unique_values_count": len(data["values"]),
                    "top_values": [{"value": v, "count": c} for v, c in top_values],
                })
        
        return {
            "params": formatted_params[:50],  # Ограничиваем 50 самыми популярными
            "offer_tags": formatted_tags,
            "total_param_types": len(param_analysis),
            "total_offer_tag_types": len([t for t in offer_tags_analysis.values() if t["count"] > 0]),
        }

    def run_full_check(self):
        """Запуск полной проверки фида"""
        result = {}

        # 1. Проверка синтаксиса XML (базовая проверка парсинга)
        syntax_check = self.check_xml_syntax()
        result["syntax"] = syntax_check

        # 2. Парсинг дерева (пробуем даже если есть XML ошибки, используя recover=True)
        # Это позволит продолжить проверку других вещей, даже если XML имеет синтаксические ошибки
        try:
            self.get_tree_object()
        except Exception as e:
            logger.warning(f"⚠️ Could not parse XML tree (XML syntax errors may prevent parsing): {e}")
            # Если не удалось построить дерево, все равно продолжаем проверку других вещей
            # (хотя некоторые проверки могут не работать без дерева)
            if not syntax_check.get("valid", True):
                # Если XML невалиден и дерево не построено, возвращаем результат с XML ошибками
                # но все равно пытаемся найти другие проблемы, если возможно
                logger.warning("⚠️ XML syntax errors found, but attempting to continue with other checks...")
                # Пробуем использовать recover=True для построения дерева
                try:
                    if self.file_content:
                        parser = etree.XMLParser(recover=True)
                        self.feed_tree = etree.fromstring(self.file_content, parser=parser)
                    else:
                        site_data = self.get_url_text()
                        if 'UTF-8' in site_data or 'utf-8' in site_data:
                            encoding = 'utf-8'
                        elif 'windows-1251' in site_data:
                            encoding = 'cp1251'
                        else:
                            encoding = 'utf-8'
                        xml_bytes = bytes(site_data, encoding=encoding)
                        parser = etree.XMLParser(recover=True)
                        self.feed_tree = etree.fromstring(xml_bytes, parser=parser)
                    logger.info("✅ Successfully parsed XML with recover=True, continuing checks...")
                except Exception as recover_error:
                    logger.error(f"❌ Could not recover XML tree: {recover_error}")
                    # Если не удалось восстановить, возвращаем только XML ошибки
                    return result
        
        # Инициализируем site_offers для валидации (нужно для проверки в дереве)
        if self.feed_tree is not None:
            self.site_offers = [elem for elem in self.feed_tree.iter('offer')]

        # 3. Валидация параметров (критическая проверка - собираем все ошибки, но продолжаем проверку)
        # Это бизнес-валидация, которая должна влиять на результат синтаксической проверки
        logger.info("=" * 80)
        logger.info("🔍 STARTING PARAM VALIDATION (COLLECTING ALL ERRORS)")
        logger.info("=" * 80)
        logger.info(f"📦 Offers count: {len(self.site_offers) if self.site_offers else 0}")
        logger.info(f"🌳 Feed tree is None: {self.feed_tree is None}")
        
        try:
            param_validation_errors = self.validate_params()
            logger.info("=" * 80)
            logger.info(f"🔍 VALIDATION COMPLETE: Found {len(param_validation_errors)} errors")
            logger.info("=" * 80)
        except Exception as e:
            logger.error(f"❌ ERROR in validate_params: {e}", exc_info=True)
            param_validation_errors = []
            logger.warning("⚠️ Continuing with empty param validation errors list")
        
        # Разделяем ошибки на типы
        missing_name_errors = []
        duplicate_errors = []
        
        for error in param_validation_errors:
            if "без атрибута name" in str(error.get("error", "")):
                missing_name_errors.append(error)
            else:
                duplicate_errors.append(error)
        
        # Сохраняем ошибки для дальнейшего использования
        if missing_name_errors:
            self.invalid_param_errors = missing_name_errors
        if duplicate_errors:
            self.duplicate_param_errors = duplicate_errors
        
        # Обновляем результат синтаксической проверки, если есть ошибки
        if param_validation_errors:
            logger.warning(f"⚠️ Found {len(missing_name_errors)} missing name errors and {len(duplicate_errors)} duplicate errors")
            
            # Помечаем синтаксис как невалидный
            result["syntax"]["valid"] = False
            
            # Формируем общее сообщение об ошибках
            error_messages = []
            if missing_name_errors:
                error_messages.append(f"{len(missing_name_errors)} тегов <param> без атрибута name")
            if duplicate_errors:
                error_messages.append(f"{len(duplicate_errors)} дубликатов параметров")
            
            result["syntax"]["error_code"] = "PARAM_VALIDATION_ERROR" if missing_name_errors else "PARAM_DUPLICATE_ERROR"
            result["syntax"]["message"] = f"Обнаружено: {', '.join(error_messages)}"
            
            # Формируем понятное сообщение с первой ошибкой
            first_error = param_validation_errors[0]
            if first_error.get("line_number"):
                result["syntax"]["human_message"] = f"❌ Строка {first_error['line_number']}: {first_error.get('message', 'Ошибка валидации параметров')}"
                result["syntax"]["line"] = first_error["line_number"]
                result["syntax"]["error_line"] = first_error.get("full_line", "")
            else:
                result["syntax"]["human_message"] = f"❌ Обнаружено: {', '.join(error_messages)}"
            
            result["syntax"]["translated_error"] = "Ошибки валидации параметров: проверьте все теги <param>"
            
            # Сохраняем ВСЕ ошибки (без ограничений)
            result["syntax"]["param_validation_errors"] = param_validation_errors  # ВСЕ ошибки
            result["syntax"]["errors_count"] = len(param_validation_errors)
            result["syntax"]["missing_name_errors"] = missing_name_errors  # ВСЕ ошибки
            result["syntax"]["duplicate_param_errors"] = duplicate_errors  # ВСЕ ошибки
            result["syntax"]["missing_name_count"] = len(missing_name_errors)
            result["syntax"]["duplicate_count"] = len(duplicate_errors)
            
            # Логируем для отладки
            logger.info(f"📊 Saving to result: {len(param_validation_errors)} total errors, {len(missing_name_errors)} missing name, {len(duplicate_errors)} duplicates")
            
            logger.warning(f"⚠️ Param validation found errors, but continuing with full check...")
        else:
            logger.info("✅ Param validation passed")

        # 4. Обязательные требования (продолжаем даже если есть ошибки валидации параметров)
        try:
            mandatory = self.get_mandatory_requirements()
            result["mandatory"] = mandatory
        except Exception as e:
            logger.error(f"❌ Error in get_mandatory_requirements: {e}", exc_info=True)
            result["mandatory"] = {"error": str(e)}

        # 5. Получение детальной информации о проблемных товарах
        try:
            problematic_offers = {
                "missing_id": self.get_problematic_offers(ProblemType.MISSING_ID),
                "missing_availability": self.get_problematic_offers(ProblemType.MISSING_AVAILABLE),
                "missing_name": self.get_problematic_offers(ProblemType.MISSING_NAME),
                "missing_link": self.get_problematic_offers(ProblemType.MISSING_LINK),
                "price_issues": self.get_problematic_offers(ProblemType.PRICE_ISSUES),
                "missing_category": self.get_problematic_offers(ProblemType.MISSING_CATEGORY),
                "invalid_category": self.get_problematic_offers(ProblemType.INVALID_CATEGORY),
                "multiple_categories": self.get_problematic_offers(ProblemType.MULTIPLE_CATEGORIES),
                "vendor_issues": self.get_problematic_offers(ProblemType.MISSING_VENDOR),
                "missing_image": self.get_problematic_offers(ProblemType.MISSING_IMAGE),
            }
            result["problematic_offers"] = problematic_offers
        except Exception as e:
            logger.error(f"❌ Error in get_problematic_offers: {e}", exc_info=True)
            result["problematic_offers"] = {"error": str(e)}

        # 6. Проверка категорий
        try:
            categories = self.check_category_issues()
            result["categories"] = categories
        except Exception as e:
            logger.error(f"❌ Error in check_category_issues: {e}", exc_info=True)
            result["categories"] = {"error": str(e)}
        
        # 7. Построение дерева категорий
        try:
            logger.info("🌳 Building category tree...")
            category_tree = self.build_category_tree()
            result["category_tree"] = category_tree
            logger.info(f"✅ Category tree built: {len(category_tree['tree'])} root categories, {len(category_tree['orphaned_categories'])} orphaned")
        except Exception as e:
            logger.error(f"❌ Error in build_category_tree: {e}", exc_info=True)
            result["category_tree"] = {"error": str(e)}
        
        # 8. Анализ параметров
        try:
            logger.info("📈 Analyzing parameters...")
            params_stats = self.analyze_parameters()
            result["params_stats"] = params_stats
            logger.info(f"✅ Parameters analyzed: avg {params_stats['avg_params_per_offer']} params per offer")
        except Exception as e:
            logger.error(f"❌ Error in analyze_parameters: {e}", exc_info=True)
            result["params_stats"] = {"error": str(e)}
        
        # 9. Анализ атрибутов и значений
        try:
            logger.info("🏷️ Analyzing attributes...")
            attributes_analysis = self.analyze_attributes()
            result["attributes_analysis"] = attributes_analysis
            logger.info(f"✅ Attributes analyzed: {len(attributes_analysis['params'])} param types, {len(attributes_analysis['offer_tags'])} tag types")
        except Exception as e:
            logger.error(f"❌ Error in analyze_attributes: {e}", exc_info=True)
            result["attributes_analysis"] = {"error": str(e)}

        return result

