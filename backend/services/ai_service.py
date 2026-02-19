import os
import logging
import google.generativeai as genai
from typing import Optional
from ..config.exceptions import ServiceError

logger = logging.getLogger("ai_service")


class AiService:
    def __init__(self):
        self.api_key = os.environ.get("GOOGLE_API_KEY")
        self.model = None

        if self.api_key:
            try:
                genai.configure(api_key=self.api_key)
                self.model = genai.GenerativeModel("gemini-pro")
                logger.info("AI Service Initialized (Gemini Pro)")
            except Exception as e:
                logger.error(f"Failed to initialize AI: {e}")
        else:
            logger.warning("GOOGLE_API_KEY not found. AI features disabled.")

    async def get_chat_response(self, message: str) -> str:
        if not self.model:
            raise ServiceError(
                "Serviço de IA não configurado (API Key ausente).", service="AI"
            )

        try:
            # Simple one-off generation for now.
            # For history, we'd need to manage chat sessions.
            response = await self.model.generate_content_async(message)
            return response.text
        except Exception as e:
            logger.error(f"AI Generation Error: {e}")
            raise ServiceError("Erro ao processar mensagem com IA.", service="AI")
