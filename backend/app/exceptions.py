"""
Кастомные исключения для FeedChecker
"""
from typing import Optional, Dict, Any


class FeedDownloadError(Exception):
    """
    Ошибка загрузки фида - невозможно получить данные
    """
    def __init__(
        self,
        message: str,
        error_code: str,
        url: Optional[str] = None,
        status_code: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        self.message = message
        self.error_code = error_code
        self.url = url
        self.status_code = status_code
        self.details = details or {}
        super().__init__(self.message)
    
    def to_dict(self) -> Dict[str, Any]:
        """Преобразование в словарь для JSON ответа"""
        return {
            "error_type": "DOWNLOAD_ERROR",
            "error_code": self.error_code,
            "message": self.message,
            "url": self.url,
            "status_code": self.status_code,
            "details": self.details,
        }


class FeedValidationError(Exception):
    """
    Ошибка валидации фида - данные получены, но содержат ошибки
    Это НЕ критическая ошибка - мы можем показать результаты проверки
    """
    def __init__(
        self,
        message: str,
        validation_results: Optional[Dict[str, Any]] = None
    ):
        self.message = message
        # Убеждаемся, что validation_results - это словарь, а не список
        if validation_results is None:
            self.validation_results = {}
        elif isinstance(validation_results, dict):
            self.validation_results = validation_results
        else:
            # Если передан не словарь, оборачиваем в словарь
            self.validation_results = {"error_data": validation_results}
        super().__init__(self.message)

