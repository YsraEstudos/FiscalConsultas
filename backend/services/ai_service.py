import logging
import os

try:
    import google.generativeai as genai
    _genai_import_error: Exception | None = None
except Exception as exc:
    # Keep backend startup resilient when optional AI provider deps are broken.
    genai = None
    _genai_import_error = exc

from ..config.exceptions import ServiceError

logger = logging.getLogger("ai_service")


class AiService:
    def __init__(self):
        self.api_key = os.environ.get("GOOGLE_API_KEY")
        self.model = None
        self.ai_disabled_reason: str | None = None

        if self.api_key:
            if genai is None:
                self.ai_disabled_reason = f"Provider import failed: {_genai_import_error}"
                logger.error(
                    "AI provider unavailable: %s. AI features disabled.",
                    _genai_import_error,
                )
                return

            try:
                genai.configure(api_key=self.api_key)  # pyright: ignore[reportPrivateImportUsage]
                self.model = genai.GenerativeModel(  # pyright: ignore[reportPrivateImportUsage]
                    "gemini-pro"
                )
                logger.info("AI Service Initialized (Gemini Pro)")
            except Exception as e:
                self.ai_disabled_reason = f"Provider initialization failed: {e}"
                logger.error(f"Failed to initialize AI: {e}")
        else:
            self.ai_disabled_reason = "API key ausente"
            logger.warning("GOOGLE_API_KEY not found. AI features disabled.")

    async def get_chat_response(self, message: str) -> str:
        if not self.model:
            reason = self.ai_disabled_reason or "API key ausente"
            raise ServiceError(
                f"Serviço de IA não configurado ({reason}).", service="AI"
            )

        try:
            # Simple one-off generation for now.
            # For history, we'd need to manage chat sessions.
            response = await self.model.generate_content_async(message)
            return response.text
        except Exception as e:
            logger.error(f"AI Generation Error: {e}")
            raise ServiceError("Erro ao processar mensagem com IA.", service="AI")
