from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
import logging
import tempfile
import os
import json
import asyncio
import threading
from pathlib import Path
from typing import AsyncGenerator, Dict, Any
from uuid import uuid4
from datetime import datetime

from app.feed_checker import FeedChecker, ProblemType
from app.delta_feed_checker import DeltaFeedChecker
from app.excel_export import create_excel_report
from app.exceptions import FeedDownloadError, FeedValidationError

# Настройка логирования
log_format = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'

# Определяем путь к файлу логов
# В Docker контейнере используем /app/backend.log, локально - в корне проекта
if os.path.exists('/app'):
    # Мы в Docker контейнере
    log_file_path = Path('/app/backend.log')
else:
    # Локальная разработка - в корне проекта
    log_file_path = Path(__file__).parent.parent.parent.parent / 'backend.log'

# Создаем handlers для логирования
# Исправляем кодировку для Windows консоли
import sys
if sys.platform == 'win32':
    import io
    # Устанавливаем UTF-8 для stdout/stderr в Windows
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')

handlers = [logging.StreamHandler()]  # Всегда логируем в консоль (stdout/stderr)

# Пробуем добавить файловый handler, но не падаем если не получилось
try:
    log_file_path.parent.mkdir(parents=True, exist_ok=True)
    # Проверяем права на запись
    test_file = log_file_path.parent / '.write_test'
    try:
        test_file.write_text('test')
        test_file.unlink()
        handlers.append(logging.FileHandler(log_file_path, encoding='utf-8', mode='a'))
        print(f"Log file will be written to: {log_file_path}")
    except Exception:
        print(f"Cannot write to log file directory: {log_file_path.parent}, using console only")
except Exception as e:
    print(f"Could not setup log file: {e}, using console only")

logging.basicConfig(
    level=logging.INFO,
    format=log_format,
    handlers=handlers,
    force=True  # Перезаписываем существующие настройки
)
logger = logging.getLogger(__name__)

# Тестовая запись в лог
logger.info("="*80)
logger.info("Backend application starting...")
logger.info(f"Log file path: {log_file_path}")
logger.info(f"Working directory: {os.getcwd()}")
logger.info(f"Python path: {os.sys.path[:3]}")
logger.info("="*80)

app = FastAPI(
    title="FeedChecker API",
    description="API для проверки и валидации XML/YML фидов товаров",
    version="1.0.0",
)

# CORS middleware
cors_origins_env = os.getenv("CORS_ORIGINS", "*")
if cors_origins_env == "*":
    cors_origins = ["*"]
    logger.info(f"CORS origins configured: * (all origins allowed)")
else:
    cors_origins = [origin.strip() for origin in cors_origins_env.split(",")]
    logger.info(f"CORS origins configured: {cors_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Middleware для логирования всех запросов
@app.middleware("http")
async def log_requests(request, call_next):
    # Пропускаем логирование health checks - они слишком частые и не несут полезной информации
    is_health_check = request.url.path == "/health"
    
    if not is_health_check:
        # Логируем в файл и консоль
        log_msg = f"📥 Incoming request: {request.method} {request.url.path}"
        logger.info(log_msg)
        
        if request.url.query:
            log_msg = f"   Query params: {request.url.query}"
            logger.info(log_msg)
    
    response = await call_next(request)
    
    if not is_health_check:
        log_msg = f"📤 Response: {response.status_code} for {request.method} {request.url.path}"
        logger.info(log_msg)
    
    return response

# In-memory job storage (в production использовать Redis)
jobs: Dict[str, Dict[str, Any]] = {}
jobs_lock = threading.Lock()

async def process_feed_background(job_id: str, site_id: int, feed_url: str = None, file_content: bytes = None, feed_type: str = "xml", delimiter: str = ";"):
    """
    Фоновая обработка фида
    """
    try:
        with jobs_lock:
            jobs[job_id]["status"] = "processing"
            jobs[job_id]["progress"] = 10
            jobs[job_id]["message"] = "Начинаем обработку фида..."

        logger.info(f"🔄 Starting background job {job_id} for site_id {site_id}, feed_type: {feed_type}")

        feed_type_lower = feed_type.lower() if feed_type else "xml"
        
        # Создаем checker в зависимости от типа фида
        if feed_type_lower == "delta":
            if feed_url:
                checker = DeltaFeedChecker(
                    site_id=site_id,
                    site_url=feed_url,
                    delimiter=delimiter
                )
            else:
                checker = DeltaFeedChecker(
                    site_id=site_id,
                    file_content=file_content,
                    delimiter=delimiter
                )
        else:
            if feed_url:
                checker = FeedChecker(site_id=site_id, site_url=feed_url)
            else:
                checker = FeedChecker(site_id=site_id, file_content=file_content)

        with jobs_lock:
            jobs[job_id]["progress"] = 30
            jobs[job_id]["message"] = "Загрузка и парсинг фида..."

        # Запускаем в thread pool чтобы не блокировать event loop
        result = await asyncio.to_thread(checker.run_full_check)

        with jobs_lock:
            jobs[job_id]["status"] = "completed"
            jobs[job_id]["progress"] = 100
            jobs[job_id]["message"] = "Обработка завершена"
            jobs[job_id]["result"] = result
            jobs[job_id]["result"]["site_id"] = site_id
            jobs[job_id]["completed_at"] = datetime.now().isoformat()

        logger.info(f"✅ Job {job_id} completed successfully")

    except FeedDownloadError as e:
        logger.error(f"❌ Job {job_id} failed with download error: {e.message}")
        with jobs_lock:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["error"] = {
                "error_type": "download_error",
                "error_code": e.error_code,
                "message": e.message,
                "url": e.url,
                "http_status": e.status_code,
                "details": e.details
            }
            jobs[job_id]["failed_at"] = datetime.now().isoformat()

    except FeedValidationError as e:
        logger.warning(f"⚠️ Job {job_id} completed with validation error: {e.message}")
        # Убеждаемся, что validation_results - это словарь, а не список
        validation_results = e.validation_results if isinstance(e.validation_results, dict) else {}
        
        with jobs_lock:
            jobs[job_id]["status"] = "completed_with_errors"
            jobs[job_id]["progress"] = 100
            jobs[job_id]["message"] = "Обработка завершена с ошибками валидации"
            jobs[job_id]["result"] = {
                "site_id": site_id,
                "validation_error": True,
                "message": e.message,
                **validation_results
            }
            jobs[job_id]["completed_at"] = datetime.now().isoformat()

    except Exception as e:
        logger.error(f"💥 Job {job_id} failed with unexpected error: {str(e)}", exc_info=True)
        with jobs_lock:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["error"] = {
                "error_type": "internal_error",
                "message": f"Внутренняя ошибка: {str(e)}",
                "error_class": type(e).__name__
            }
            jobs[job_id]["failed_at"] = datetime.now().isoformat()

@app.get("/")
async def root():
    """Корневой endpoint"""
    return {
        "message": "FeedChecker API",
        "version": "1.0.0",
        "docs": "/docs",
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Проверяем, что основные модули импортируются
        import app.feed_checker
        import app.delta_feed_checker
        return {
            "status": "ok",
            "timestamp": datetime.now().isoformat(),
            "version": "1.0.0"
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=503, detail=f"Service unhealthy: {str(e)}")

@app.get("/api/logs")
async def get_logs(lines: int = 100):
    """
    Получить последние N строк логов
    
    Args:
        lines: Количество последних строк для возврата (по умолчанию 100, максимум 1000)
    """
    try:
        # Ограничиваем максимум 1000 строк
        lines = min(max(1, lines), 1000)
        
        if not log_file_path.exists():
            return {
                "error": "Log file not found",
                "log_file_path": str(log_file_path),
                "exists": False,
                "message": "Файл логов не найден. Возможно, логирование в файл не настроено."
            }
        
        # Читаем последние N строк
        with open(log_file_path, 'r', encoding='utf-8', errors='ignore') as f:
            all_lines = f.readlines()
            last_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
        
        return {
            "log_file_path": str(log_file_path),
            "total_lines": len(all_lines),
            "returned_lines": len(last_lines),
            "lines": last_lines,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Error reading logs: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка при чтении логов: {str(e)}")

@app.get("/api/logs/download")
async def download_logs():
    """
    Скачать полный файл логов
    """
    try:
        if not log_file_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Файл логов не найден: {log_file_path}"
            )
        
        return FileResponse(
            path=str(log_file_path),
            filename=f"backend_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log",
            media_type="text/plain"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading logs: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка при скачивании логов: {str(e)}")

@app.get("/api/logs/info")
async def get_logs_info():
    """
    Получить информацию о файле логов
    """
    try:
        if not log_file_path.exists():
            return {
                "exists": False,
                "log_file_path": str(log_file_path),
                "message": "Файл логов не найден"
            }
        
        stat = log_file_path.stat()
        with open(log_file_path, 'r', encoding='utf-8', errors='ignore') as f:
            line_count = sum(1 for _ in f)
        
        return {
            "exists": True,
            "log_file_path": str(log_file_path),
            "size_bytes": stat.st_size,
            "size_mb": round(stat.st_size / 1024 / 1024, 2),
            "line_count": line_count,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
        }
    except Exception as e:
        logger.error(f"Error getting logs info: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка при получении информации о логах: {str(e)}")

@app.post("/api/check-feed-async")
async def check_feed_async(
    site_id: int = Form(...),
    feed_url: str = Form(None),
    feed_file: UploadFile = File(None),
    feed_type: str = Form("xml"),
    delimiter: str = Form(";"),
):
    """
    Асинхронная проверка фида - для больших файлов
    Возвращает job_id для отслеживания прогресса
    """
    try:
        if not feed_url and not feed_file:
            raise HTTPException(
                status_code=400,
                detail="Необходимо указать либо URL фида, либо загрузить файл",
            )

        if feed_url and feed_file:
            raise HTTPException(
                status_code=400,
                detail="Укажите только один источник: URL или файл",
            )

        # Создаем уникальный ID задачи
        job_id = str(uuid4())

        # Инициализируем задачу
        with jobs_lock:
            jobs[job_id] = {
                "job_id": job_id,
                "site_id": site_id,
                "status": "pending",
                "progress": 0,
                "message": "Задача создана, ожидает обработки",
                "created_at": datetime.now().isoformat(),
                "result": None,
                "error": None
            }

        # Читаем файл если нужно
        file_content = None
        if feed_file:
            file_content = await feed_file.read()
            logger.info(f"📁 Created async job {job_id} for file: {feed_file.filename} ({len(file_content)} bytes)")
        else:
            logger.info(f"🔗 Created async job {job_id} for URL: {feed_url}")

        # Запускаем фоновую обработку
        asyncio.create_task(
            process_feed_background(job_id, site_id, feed_url, file_content, feed_type, delimiter)
        )

        return JSONResponse({
            "job_id": job_id,
            "status": "pending",
            "message": "Задача создана и запущена в фоновом режиме",
            "poll_url": f"/api/job/{job_id}",
            "created_at": jobs[job_id]["created_at"]
        })

    except Exception as e:
        logger.error(f"Error creating async job: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/job/{job_id}")
async def get_job_status(job_id: str, include_result: bool = False):
    """
    Получение статуса асинхронной задачи

    Статусы:
    - pending: задача создана, ожидает обработки
    - processing: задача выполняется
    - completed: задача завершена успешно
    - completed_with_errors: задача завершена с ошибками валидации
    - failed: задача завершилась с ошибкой

    По умолчанию результат не включается (для polling).
    Используйте include_result=true для получения полного результата.
    """
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(
                status_code=404,
                detail=f"Job {job_id} not found"
            )

        job = jobs[job_id].copy()

        # Не включаем результат в polling ответы для экономии трафика
        if not include_result and "result" in job:
            # Оставляем только метаданные о результате
            job["has_result"] = True
            job["result"] = None

    return JSONResponse(job)

@app.delete("/api/job/{job_id}")
async def delete_job(job_id: str):
    """
    Удаление задачи из памяти (очистка)
    """
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(
                status_code=404,
                detail=f"Job {job_id} not found"
            )

        del jobs[job_id]

    return JSONResponse({"message": f"Job {job_id} deleted"})

@app.get("/api/jobs")
async def list_jobs():
    """
    Список всех задач (для дебаггинга)
    """
    with jobs_lock:
        jobs_list = [
            {
                "job_id": job_id,
                "site_id": job["site_id"],
                "status": job["status"],
                "progress": job["progress"],
                "created_at": job["created_at"]
            }
            for job_id, job in jobs.items()
        ]

    return JSONResponse({
        "total": len(jobs_list),
        "jobs": jobs_list
    })

@app.post("/api/check-feed")
async def check_feed(
    site_id: int = Form(...),
    feed_url: str = Form(None),
    feed_file: UploadFile = File(None),
    feed_type: str = Form("xml"),  # "xml" или "delta"
    delimiter: str = Form(";"),  # Разделитель для дельта-фидов
):
    logger.info(f"🔵 Received check-feed request: site_id={site_id}, feed_type={feed_type}, feed_url={feed_url}, has_file={feed_file is not None}")
    """
    Основной endpoint для проверки фида
    
    Parameters:
    - site_id: ID сайта
    - feed_url: URL фида (опционально)
    - feed_file: Файл фида (опционально)
    - feed_type: Тип фида - "xml" (по умолчанию) или "delta"
    - delimiter: Разделитель для дельта-фидов (по умолчанию ";")
    
    Должен быть указан либо feed_url, либо feed_file
    """
    try:
        if not feed_url and not feed_file:
            raise HTTPException(
                status_code=400,
                detail="Необходимо указать либо URL фида, либо загрузить файл",
            )
        
        if feed_url and feed_file:
            raise HTTPException(
                status_code=400,
                detail="Укажите только один источник: URL или файл",
            )
        
        # Определяем тип фида
        feed_type_lower = feed_type.lower() if feed_type else "xml"
        
        if feed_type_lower == "delta":
            # Проверка дельта-фида
            if feed_url:
                logger.info(f"🔍 Checking delta feed from URL: {feed_url} for site_id: {site_id}")
                checker = DeltaFeedChecker(
                    site_id=site_id,
                    site_url=feed_url,
                    delimiter=delimiter
                )
            else:
                logger.info(f"📁 Checking delta feed from file: {feed_file.filename} for site_id: {site_id}")
                file_content = await feed_file.read()
                checker = DeltaFeedChecker(
                    site_id=site_id,
                    file_content=file_content,
                    delimiter=delimiter,
                    filename=feed_file.filename
                )
            
            # Запуск полной проверки дельта-фида
            logger.info(f"⚙️ Running delta feed check for site_id: {site_id}")
            result = checker.run_full_check()
            
            # Добавляем тип фида в результат
            result["feed_type"] = "delta"
            result["site_id"] = site_id
            
            logger.info(f"✅ Delta feed check completed successfully for site_id: {site_id}")
            return JSONResponse(content=result)
        else:
            # Проверка обычного XML/YML фида
            if feed_url:
                logger.info(f"🔍 Checking XML feed from URL: {feed_url} for site_id: {site_id}")
                logger.info(f"📋 URL details: scheme={feed_url.split('://')[0] if '://' in feed_url else 'unknown'}")
                checker = FeedChecker(site_id=site_id, site_url=feed_url)
            else:
                logger.info(f"📁 Checking feed from file: {feed_file.filename} for site_id: {site_id}")
                file_content = await feed_file.read()
                checker = FeedChecker(site_id=site_id, file_content=file_content)
            
            # Запуск полной проверки
            logger.info(f"⚙️ Running full feed check for site_id: {site_id}")
            result = checker.run_full_check()
            
            # Добавляем site_id и тип фида в результат
            result["site_id"] = site_id
            result["feed_type"] = "xml"
            
            # Логируем наличие новых полей
            logger.info(f"✅ Feed check completed successfully for site_id: {site_id}")
            logger.info(f"📊 Result keys: {list(result.keys())}")
            logger.info(f"🌳 Has category_tree: {'category_tree' in result}")
            logger.info(f"📈 Has params_stats: {'params_stats' in result}")
            logger.info(f"🏷️ Has attributes_analysis: {'attributes_analysis' in result}")
            
            return JSONResponse(content=result)
    
    except FeedDownloadError as e:
        # ОШИБКА ЗАГРУЗКИ - фид не был получен
        logger.error(f"❌ DOWNLOAD ERROR for site_id {site_id}: {e.error_code} - {e.message}")
        logger.error(f"   URL: {e.url}")
        logger.error(f"   Status code: {e.status_code}")
        logger.error(f"   Details: {e.details}")
        
        # Возвращаем детальную информацию об ошибке загрузки
        error_dict = e.to_dict()
        error_dict["timestamp"] = str(Path(__file__).stat().st_mtime)
        error_dict["help"] = "Это ошибка загрузки фида. Фид не был получен с сервера."
        
        raise HTTPException(
            status_code=400,
            detail=error_dict
        )
    
    except FeedValidationError as e:
        # ОШИБКА ВАЛИДАЦИИ - фид получен, но содержит ошибки
        # Это НЕ критично - мы можем показать результаты
        logger.warning(f"⚠️ VALIDATION ERROR for site_id {site_id}: {e.message}")
        logger.warning(f"   Validation results: {e.validation_results}")
        
        # Для дельта-фидов возвращаем структурированную ошибку
        if feed_type_lower == "delta":
            # Убеждаемся, что validation_results - это словарь, а не список
            validation_results = e.validation_results if isinstance(e.validation_results, dict) else {}
            
            return JSONResponse(content={
                "site_id": site_id,
                "feed_type": "delta",
                "validation_error": True,
                "message": e.message,
                "parsing": {
                    "total_rows": 0,
                    "has_headers": False,
                    "headers": None,
                    "error": e.message,
                    "error_details": validation_results
                },
                "summary": {
                    "total_rows": 0,
                    "available_count": 0,
                    "unavailable_count": 0,
                    "unique_ids_count": 0
                },
                "problems": {
                    "missing_id": 0,
                    "missing_price": 0,
                    "invalid_price": 0,
                    "missing_available": 0,
                    "duplicate_ids": 0
                },
                "optional_fields": {
                    "rows_with_oldprice": 0,
                    "rows_with_region": 0,
                    "rows_with_attributes": 0,
                    "attribute_names": []
                },
                "duplicate_ids_details": [],
                **validation_results
            })
        else:
            # Убеждаемся, что validation_results - это словарь, а не список
            validation_results = e.validation_results if isinstance(e.validation_results, dict) else {}
            
            return JSONResponse(content={
                "site_id": site_id,
                "validation_error": True,
                "message": e.message,
                **validation_results
            })
        
    except Exception as e:
        # Непредвиденная ошибка
        logger.error(f"💥 UNEXPECTED ERROR for site_id {site_id}: {type(e).__name__}")
        logger.error(f"   Message: {str(e)}", exc_info=True)
        
        raise HTTPException(
            status_code=500,
            detail={
                "error_type": "INTERNAL_ERROR",
                "message": f"Внутренняя ошибка сервера: {str(e)}",
                "error_class": type(e).__name__,
                "help": "Обратитесь к разработчикам с логами"
            }
        )

@app.get("/api/check-feed-stream")
async def check_feed_stream(
    site_id: int,
    feed_url: str,
):
    """
    Streaming endpoint для проверки фида с прогрессом загрузки
    Использует Server-Sent Events (SSE)
    """
    
    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            logger.info(f"🔄 Starting stream check for URL: {feed_url}, site_id: {site_id}")
            
            # Callback для отслеживания прогресса с thread-safe обновлением
            progress_data = {"loaded": 0, "total": 0}
            progress_lock = threading.Lock()
            
            def progress_callback(loaded: int, total: int):
                with progress_lock:
                    progress_data["loaded"] = loaded
                    progress_data["total"] = total
            
            # Отправляем начальное событие
            yield f"data: {json.dumps({'type': 'start', 'message': 'Начинаем загрузку фида...'})}\n\n"
            await asyncio.sleep(0.05)  # Быстрее начинаем
            
            # Создаем checker с прогресс-колбэком
            checker = FeedChecker(
                site_id=site_id, 
                site_url=feed_url,
                progress_callback=progress_callback
            )
            
            # Отправляем событие о начале загрузки
            yield f"data: {json.dumps({'type': 'downloading', 'message': 'Загрузка фида...'})}\n\n"
            
            # Запускаем проверку в отдельном потоке и мониторим прогресс
            result = None
            error = None
            
            async def run_check():
                nonlocal result, error
                try:
                    logger.info(f"🔄 Starting feed check in thread pool for URL: {feed_url}")
                    import concurrent.futures
                    loop = asyncio.get_event_loop()
                    with concurrent.futures.ThreadPoolExecutor() as pool:
                        result = await loop.run_in_executor(pool, checker.run_full_check)
                    logger.info(f"✅ Feed check completed successfully")
                except Exception as e:
                    logger.error(f"❌ Error in run_check: {str(e)}", exc_info=True)
                    error = e
            
            # Запускаем проверку
            check_task = asyncio.create_task(run_check())
            
            # Мониторим прогресс пока идет загрузка
            last_loaded = 0
            keepalive_counter = 0
            iteration = 0
            while not check_task.done():
                await asyncio.sleep(0.2)  # 5 обновлений в секунду для плавности
                keepalive_counter += 1
                iteration += 1
                
                # Читаем прогресс thread-safe
                with progress_lock:
                    current_loaded = progress_data["loaded"]
                    current_total = progress_data["total"]
                
                # Логируем каждые 10 итераций (каждые 2 секунды)
                if iteration % 10 == 0:
                    logger.info(f"📊 Progress check #{iteration}: loaded={current_loaded}, total={current_total}, task_done={check_task.done()}")
                
                if current_total > 0 and current_loaded != last_loaded:
                    # Вычисляем процент с ограничением 0-100%
                    percentage = int((current_loaded / current_total) * 100)
                    percentage = max(0, min(percentage, 100))  # Ограничиваем 0-100
                    
                    logger.info(f"📤 Sending progress: {current_loaded}/{current_total} ({percentage}%)")
                    yield f"data: {json.dumps({'type': 'progress', 'loaded': current_loaded, 'total': current_total, 'percentage': percentage})}\n\n"
                    last_loaded = current_loaded
                    keepalive_counter = 0  # Сбрасываем счетчик при отправке данных
                
                # Keep-alive пинг каждые 5 секунд (25 итераций по 0.2с)
                # Предотвращает таймаут на бесплатных хостингах (Render, Railway и т.д.)
                elif keepalive_counter >= 25:
                    logger.info("💓 Sending keepalive ping")
                    yield ": keepalive\n\n"  # SSE комментарий, браузер игнорирует
                    keepalive_counter = 0
            
            # Дожидаемся завершения
            await check_task
            
            if error:
                raise error
            
            # Отправляем событие о завершении
            yield f"data: {json.dumps({'type': 'processing', 'message': 'Обработка данных...'})}\n\n"
            await asyncio.sleep(0.1)  # Быстрее показываем результат
            
            # Отправляем результат
            result["site_id"] = site_id
            
            # Логируем наличие новых полей
            logger.info(f"📊 Stream result keys: {list(result.keys())}")
            logger.info(f"🌳 Has category_tree: {'category_tree' in result}")
            logger.info(f"📈 Has params_stats: {'params_stats' in result}")
            logger.info(f"🏷️ Has attributes_analysis: {'attributes_analysis' in result}")
            
            yield f"data: {json.dumps({'type': 'complete', 'result': result})}\n\n"
            
        except FeedDownloadError as e:
            logger.error(f"❌ DOWNLOAD ERROR: {e.message}")
            error_data = {
                'type': 'error',
                'error_type': 'download_error',
                'error_code': e.error_code,
                'message': e.message,
                'url': e.url,
                'http_status': e.status_code,
                'details': e.details,
                'human_readable': True,
            }
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"
            
        except Exception as e:
            logger.error(f"💥 STREAM ERROR: {str(e)}", exc_info=True)
            error_data = {
                'type': 'error',
                'error_type': 'unknown',
                'message': str(e)
            }
            yield f"data: {json.dumps(error_data)}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )

@app.post("/api/check-syntax")
async def check_syntax(
    site_id: int = Form(...),
    feed_url: str = Form(None),
    feed_file: UploadFile = File(None),
):
    """
    Проверка только синтаксиса XML
    """
    try:
        if not feed_url and not feed_file:
            raise HTTPException(
                status_code=400,
                detail="Необходимо указать либо URL фида, либо загрузить файл",
            )
        
        if feed_url:
            checker = FeedChecker(site_id=site_id, site_url=feed_url)
        else:
            file_content = await feed_file.read()
            checker = FeedChecker(site_id=site_id, file_content=file_content)
        
        result = checker.check_xml_syntax()
        return JSONResponse(content=result)
        
    except Exception as e:
        logger.error(f"Error checking syntax: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/get-problematic-offers")
async def get_problematic_offers(
    site_id: int = Form(...),
    feed_url: str = Form(None),
    feed_file: UploadFile = File(None),
    problem_type: str = Form(...),
):
    """
    Получение списка проблемных товаров определенного типа
    
    problem_type может быть:
    - MISSING_ID
    - MISSING_AVAILABLE
    - MISSING_NAME
    - MISSING_LINK
    - PRICE_ISSUES
    - MISSING_CATEGORY
    - INVALID_CATEGORY
    - MULTIPLE_CATEGORIES
    - MISSING_VENDOR
    - MISSING_IMAGE
    """
    try:
        if not feed_url and not feed_file:
            raise HTTPException(
                status_code=400,
                detail="Необходимо указать либо URL фида, либо загрузить файл",
            )
        
        # Преобразование строки в enum
        try:
            problem_enum = ProblemType[problem_type]
        except KeyError:
            raise HTTPException(
                status_code=400,
                detail=f"Неверный тип проблемы: {problem_type}",
            )
        
        if feed_url:
            checker = FeedChecker(site_id=site_id, site_url=feed_url)
        else:
            file_content = await feed_file.read()
            checker = FeedChecker(site_id=site_id, file_content=file_content)
        
        # Запуск проверки
        checker.get_tree_object()
        checker.get_mandatory_requirements()
        
        # Получение проблемных товаров
        problematic_offers = checker.get_problematic_offers(problem_enum)
        
        return JSONResponse(content={
            "problem_type": problem_type,
            "count": len(problematic_offers),
            "offers": problematic_offers,
        })
        
    except Exception as e:
        logger.error(f"Error getting problematic offers: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/export-excel")
async def export_excel(
    site_id: int = Form(...),
    feed_url: str = Form(None),
    feed_file: UploadFile = File(None),
):
    """
    Экспорт результатов проверки в Excel файл
    """
    try:
        if not feed_url and not feed_file:
            raise HTTPException(
                status_code=400,
                detail="Необходимо указать либо URL фида, либо загрузить файл",
            )
        
        if feed_url:
            checker = FeedChecker(site_id=site_id, site_url=feed_url)
        else:
            file_content = await feed_file.read()
            checker = FeedChecker(site_id=site_id, file_content=file_content)
        
        # Запуск полной проверки
        result = checker.run_full_check()
        result["site_id"] = site_id
        
        # Создание Excel файла
        excel_path = create_excel_report(result, site_id)
        
        # Возврат файла
        return FileResponse(
            path=excel_path,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=os.path.basename(excel_path),
        )
        
    except Exception as e:
        logger.error(f"Error exporting to Excel: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

