"""
로그 설정 모듈
콘솔과 파일에 동시에 출력되는 공통 로깅 기능을 제공합니다.
"""

import os
import sys
import logging
from datetime import datetime
from logging.handlers import RotatingFileHandler


def _ensure_utf8_stdout():
    """
    stdout/stderr가 UTF-8을 사용하도록 보장합니다.
    Windows 콘솔 문자 깨짐 문제를 줄이기 위한 설정입니다.
    """
    if sys.platform == 'win32':
        # Windows에서 표준 출력 인코딩을 UTF-8로 재설정
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')


# 로그 디렉터리
LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'logs')


def setup_logger(name: str = 'mirofish', level: int = logging.DEBUG) -> logging.Logger:
    """
    로거를 설정합니다.
    
    Args:
        name: 로거 이름
        level: 로그 레벨
        
    Returns:
        설정된 로거 인스턴스
    """
    # 로그 디렉터리 생성 보장
    os.makedirs(LOG_DIR, exist_ok=True)
    
    # 로거 생성
    logger = logging.getLogger(name)
    logger.setLevel(level)
    
    # 루트 로거로 전파를 막아 중복 출력 방지
    logger.propagate = False
    
    # 기존 핸들러가 있으면 재추가하지 않음
    if logger.handlers:
        return logger
    
    # 로그 포맷
    detailed_formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    simple_formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s: %(message)s',
        datefmt='%H:%M:%S'
    )
    
    # 1) 파일 핸들러 - 상세 로그(날짜별 파일, 로테이션 포함)
    log_filename = datetime.now().strftime('%Y-%m-%d') + '.log'
    file_handler = RotatingFileHandler(
        os.path.join(LOG_DIR, log_filename),
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(detailed_formatter)
    
    # 2) 콘솔 핸들러 - 간결 로그(INFO 이상)
    # Windows에서도 UTF-8 출력이 되도록 보장
    _ensure_utf8_stdout()
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(simple_formatter)
    
    # 핸들러 등록
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger


def get_logger(name: str = 'mirofish') -> logging.Logger:
    """
    로거를 가져옵니다(없으면 생성).
    
    Args:
        name: 로거 이름
        
    Returns:
        로거 인스턴스
    """
    logger = logging.getLogger(name)
    if not logger.handlers:
        return setup_logger(name)
    return logger


# 기본 로거 생성
logger = setup_logger()


# 편의 함수
def debug(msg, *args, **kwargs):
    logger.debug(msg, *args, **kwargs)

def info(msg, *args, **kwargs):
    logger.info(msg, *args, **kwargs)

def warning(msg, *args, **kwargs):
    logger.warning(msg, *args, **kwargs)

def error(msg, *args, **kwargs):
    logger.error(msg, *args, **kwargs)

def critical(msg, *args, **kwargs):
    logger.critical(msg, *args, **kwargs)
