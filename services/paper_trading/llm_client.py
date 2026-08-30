"""
LLM 클라이언트 래퍼
OpenAI 호환 형식으로 통일해 호출합니다.
"""

import json
import re
from typing import Optional, Dict, Any, List

import httpx
from openai import OpenAI

from .config import Config
from .logger import get_logger


logger = get_logger('mirofish.llm')


class LLMClient:
    """LLM 클라이언트"""
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None
    ):
        # 호출자가 접속 정보를 직접 넘기지 않았고 OPENROUTER_API_KEY가 있으면
        # 로컬 추론 서버 대신 OpenRouter를 사용한다.
        self.use_openrouter = (
            api_key is None and base_url is None and Config.use_openrouter()
        )

        if self.use_openrouter:
            self.api_key = Config.OPENROUTER_API_KEY
            self.base_url = Config.OPENROUTER_BASE_URL
            self.model = model or Config.OPENROUTER_MODEL or Config.LLM_MODEL_NAME
            # 앞 모델이 실패하면 순서대로 넘어간다. 자기 자신은 제외한다.
            self.fallback_models = [
                name for name in Config.OPENROUTER_FALLBACK_MODELS if name != self.model
            ]
            self.max_tokens = Config.OPENROUTER_MAX_TOKENS
            read_timeout = Config.OPENROUTER_READ_TIMEOUT
            max_retries = Config.OPENROUTER_MAX_RETRIES
            default_headers = {
                "HTTP-Referer": Config.OPENROUTER_APP_URL,
                "X-Title": Config.OPENROUTER_APP_TITLE,
            }
        else:
            self.api_key = api_key or Config.LLM_API_KEY
            self.base_url = base_url or Config.LLM_BASE_URL
            self.model = model or Config.LLM_MODEL_NAME
            self.fallback_models = []
            self.max_tokens = Config.LLM_MAX_TOKENS
            # 로컬 추론은 단건 생성이 수백 초까지 걸리므로 read는 넉넉히 둔다.
            read_timeout = Config.LLM_READ_TIMEOUT
            max_retries = Config.LLM_MAX_RETRIES
            default_headers = None

        if not self.api_key:
            raise ValueError(
                "OPENROUTER_API_KEY 또는 LLM_API_KEY가 설정되지 않았습니다."
            )

        # 로컬 추론 서버(oMLX 등)는 유휴 커넥션을 서버 쪽에서 닫는다. 클라이언트가
        # 그 사실을 모른 채 keep-alive 커넥션을 재사용하면 요청이 그대로 유실되고,
        # 응답이 오지 않아 read 타임아웃까지 매달린 뒤 재시도를 반복한다.
        # (실제로 시뮬레이션이 이 문제로 30분간 멈춘 적이 있다.)
        # 유휴 커넥션을 서버보다 먼저 정리해 재사용 자체를 막는다.
        http_client = httpx.Client(
            limits=httpx.Limits(
                max_connections=Config.LLM_MAX_CONNECTIONS,
                max_keepalive_connections=Config.LLM_MAX_CONNECTIONS,
                keepalive_expiry=Config.LLM_KEEPALIVE_EXPIRY,
            )
        )

        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=httpx.Timeout(
                connect=10.0,
                read=read_timeout,
                write=60.0,
                pool=60.0,
            ),
            max_retries=max_retries,
            http_client=http_client,
            default_headers=default_headers,
        )

    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        response_format: Optional[Dict] = None,
        tools: Optional[List[Dict[str, Any]]] = None
    ) -> str:
        """
        채팅 요청을 전송합니다.

        Args:
            messages: 메시지 목록
            temperature: 온도 파라미터
            max_tokens: 최대 토큰 수
            response_format: 응답 형식(예: JSON 모드)
            tools: OpenAI 형식 도구 정의. 서버가 도구 호출을 스키마 기준으로
                파싱하게 해 인자가 유실되지 않도록 한다.

        Returns:
            모델 응답 텍스트
        """
        kwargs = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens if max_tokens is not None else self.max_tokens,
        }

        if response_format:
            kwargs["response_format"] = response_format

        # 도구 정의를 함께 보내야 서버가 스키마를 보고 인자를 해석한다.
        # 정의 없이 보내면 oMLX 는 도구 이름만 건지고 인자를 통째로 버린다.
        if tools:
            kwargs["tools"] = tools

        # thinking 제어 파라미터는 로컬 추론 서버 전용이다.
        #  - reasoning_effort : Ollama가 인식한다. oMLX는 무시한다.
        #  - chat_template_kwargs.enable_thinking : oMLX가 인식한다.
        # OpenRouter는 이 둘을 조용히 무시하지 않고 400으로 거절하는 프로바이더가
        # 있어(특히 reasoning_effort='none'은 OpenAI 스펙상 허용값이 아니다)
        # 원격 경로에서는 아예 싣지 않는다.
        if self.use_openrouter:
            extra_body: Dict[str, Any] = {}
            # OpenRouter는 자체 `reasoning` 파라미터로 사고 과정을 끈다.
            # 추론 모델(deepseek 등)이 max_tokens를 사고에 소진하고 본문을 비워
            # 보내는 것을 막고, 시뮬레이션의 호출 비용과 지연도 함께 줄인다.
            if Config.LLM_DISABLE_THINKING:
                extra_body["reasoning"] = {"enabled": False}
            # 느린 프로바이더로 라우팅되는 것을 막는다. 이게 체감 속도에 가장 크다.
            if Config.OPENROUTER_PROVIDER_SORT:
                extra_body["provider"] = {"sort": Config.OPENROUTER_PROVIDER_SORT}
            if extra_body:
                kwargs["extra_body"] = extra_body
        else:
            if Config.LLM_REASONING_EFFORT:
                kwargs["reasoning_effort"] = Config.LLM_REASONING_EFFORT
            if Config.LLM_DISABLE_THINKING:
                kwargs["extra_body"] = {
                    "chat_template_kwargs": {"enable_thinking": False}
                }

        # 앞 모델이 실패하면(레이트리밋, 모델 미제공, 빈 응답 등) 폴백 모델로
        # 순서대로 넘어간다. 로컬 경로에서는 폴백 목록이 비어 있어 1회만 시도한다.
        candidates = [self.model, *self.fallback_models]
        last_error: Optional[Exception] = None
        for index, candidate in enumerate(candidates):
            attempt = dict(kwargs, model=candidate)
            try:
                return self._complete(attempt)
            except Exception as error:  # noqa: BLE001 - 다음 모델로 넘어가기 위함
                last_error = error
                if index < len(candidates) - 1:
                    logger.warning(
                        "LLM 모델 %s 호출 실패, 폴백 %s로 재시도합니다: %s",
                        candidate, candidates[index + 1], error,
                    )
        assert last_error is not None
        raise last_error

    def _complete(self, kwargs: Dict[str, Any]) -> str:
        """단일 모델로 1회 호출하고 응답 텍스트를 정리해 반환한다."""
        response = self.client.chat.completions.create(**kwargs)
        choice = response.choices[0]
        content = choice.message.content

        # 이 프로젝트는 tools 파라미터를 쓰지 않는다. 도구는 프롬프트로 설명하고
        # 응답 텍스트에서 직접 파싱한다(report_agent._parse_tool_calls).
        # 그런데 oMLX는 도구 호출처럼 보이는 출력을 스스로 tool_calls 로 옮기고
        # content 를 비워서 돌려준다. 그대로 두면 멀쩡한 응답이 빈 응답이 된다.
        # 파서가 읽을 수 있는 <tool_call> 텍스트로 되돌린다.
        if not content:
            content = self._tool_calls_to_text(choice.message)

        # 추론 모델이 사고 과정에 토큰을 모두 소진하면 content가 비어서 돌아온다.
        # 그대로 두면 파싱 단계에서 원인을 알 수 없는 오류가 되므로 여기서 잡는다.
        # 사고 과정이 담기는 필드 이름은 백엔드마다 다르다(oMLX는 reasoning_content).
        if not content:
            reasoning = (
                getattr(choice.message, 'reasoning_content', None)
                or getattr(choice.message, 'reasoning', None)
                or ''
            )
            spent = f" (사고 과정에 {len(reasoning)}자 소비)" if reasoning else ""
            model_hint = f"[{kwargs['model']}] "
            if self.use_openrouter:
                remedy = "OPENROUTER_MAX_TOKENS를 늘리거나 다른 OPENROUTER_MODEL을 쓰세요."
            else:
                remedy = ("LLM_DISABLE_THINKING=true로 thinking을 끄거나 "
                          "LLM_MAX_TOKENS를 늘리세요.")
            if choice.finish_reason == 'length':
                raise ValueError(
                    f"{model_hint}LLM 응답이 max_tokens({kwargs['max_tokens']})에 "
                    f"걸려 잘렸습니다. {remedy}{spent}"
                )
            raise ValueError(
                f"{model_hint}LLM이 빈 응답을 반환했습니다"
                f"(finish_reason={choice.finish_reason}). {remedy}{spent}"
            )

        # 일부 모델(예: MiniMax M2.5)은 content에 <think>를 포함하므로 제거
        content = re.sub(r'<think>[\s\S]*?</think>', '', content).strip()
        return content

    @staticmethod
    def _tool_calls_to_text(message) -> str:
        """서버가 tool_calls로 옮겨 담은 도구 호출을 원래 텍스트로 되돌린다.

        report_agent._parse_tool_calls가 인식하는 형식으로 만든다.
        """
        tool_calls = getattr(message, 'tool_calls', None)
        if not tool_calls:
            return ''

        parts = []
        for call in tool_calls:
            function = getattr(call, 'function', None)
            if not function or not getattr(function, 'name', None):
                continue
            try:
                parameters = json.loads(function.arguments or '{}')
            except (TypeError, ValueError):
                parameters = {}
            parts.append(
                '<tool_call>'
                + json.dumps(
                    {"name": function.name, "parameters": parameters},
                    ensure_ascii=False,
                )
                + '</tool_call>'
            )
        return '\n'.join(parts)
    
    def chat_json(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.3,
        max_tokens: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        채팅 요청을 전송하고 JSON으로 반환합니다.
        
        Args:
            messages: 메시지 목록
            temperature: 온도 파라미터
            max_tokens: 최대 토큰 수
            
        Returns:
            파싱된 JSON 객체
        """
        response = self.chat(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"}
        )
        # 마크다운 코드 블록 표기 제거
        cleaned_response = response.strip()
        cleaned_response = re.sub(r'^```(?:json)?\s*\n?', '', cleaned_response, flags=re.IGNORECASE)
        cleaned_response = re.sub(r'\n?```\s*$', '', cleaned_response)
        cleaned_response = cleaned_response.strip()

        try:
            return json.loads(cleaned_response)
        except json.JSONDecodeError:
            raise ValueError(f"LLM이 반환한 JSON 형식이 올바르지 않습니다: {cleaned_response}")
