import json
import logging
import re
import secrets
from datetime import date, datetime, timezone
from typing import Any, Dict, Optional

from backend.config.settings import settings
from backend.domain.sqlmodels import Subscription, Tenant
from backend.infrastructure.db_engine import get_session
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

router = APIRouter()
logger = logging.getLogger("routes.webhooks")
_TENANT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,128}$")


def _extract_asaas_token(request: Request) -> str | None:
    return request.headers.get("asaas-access-token") or request.headers.get(
        "x-asaas-access-token"
    )


def _is_valid_asaas_webhook(request: Request) -> bool:
    """
    Valida token do webhook Asaas quando configurado.
    """
    configured = settings.billing.asaas_webhook_token
    if not configured:
        return True
    token = _extract_asaas_token(request)
    if not token:
        return False
    return secrets.compare_digest(token, configured)


def _parse_date(value: Any) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except Exception:
        return None


def _parse_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        parsed = datetime.fromisoformat(raw)
        if parsed.tzinfo is not None:
            # Persistimos como UTC naive para compatibilidade com DateTime sem timezone.
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception:
        logger.warning("Invalid datetime format in Asaas payload: %s", raw)
        return None


async def _get_or_update_tenant(session: Any, tenant_id: str, plan_name: str) -> None:
    tenant = await session.get(Tenant, tenant_id)
    if not tenant:
        tenant = Tenant(
            id=tenant_id,
            name=tenant_id,
            is_active=True,
            subscription_plan=plan_name,
        )
        session.add(tenant)
    else:
        tenant.is_active = True
        tenant.subscription_plan = plan_name


async def _find_asaas_subscription(
    session: Any,
    tenant_id: str,
    provider_payment_id: Optional[str],
    provider_subscription_id: Optional[str],
):
    if provider_payment_id:
        result = await session.execute(
            select(Subscription).where(
                Subscription.provider == "asaas",
                Subscription.provider_payment_id == provider_payment_id,
            )
        )
        subscription = result.scalars().first()
        if subscription:
            return subscription

    if provider_subscription_id:
        result = await session.execute(
            select(Subscription).where(
                Subscription.provider == "asaas",
                Subscription.provider_subscription_id == provider_subscription_id,
            )
        )
        subscription = result.scalar_one_or_none()
        if subscription:
            return subscription

    result = await session.execute(
        select(Subscription)
        .where(
            Subscription.provider == "asaas",
            Subscription.tenant_id == tenant_id,
        )
        .order_by(Subscription.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _upsert_subscription(
    session: Any,
    subscription: Optional[Subscription],
    **data: Any,
) -> None:
    if not subscription:
        subscription = Subscription(
            tenant_id=data["tenant_id"],
            provider="asaas",
            provider_customer_id=data.get("provider_customer_id"),
            provider_subscription_id=data.get("provider_subscription_id"),
            provider_payment_id=data.get("provider_payment_id"),
            plan_name=data["plan_name"],
            status=data["payment_status"],
            amount=data.get("amount"),
            billing_cycle=data.get("billing_cycle"),
            next_due_date=data.get("next_due_date"),
            last_payment_date=data.get("last_payment_date"),
            last_event="PAYMENT_CONFIRMED",
            raw_payload=data["raw_payload"],
            updated_at=data["now"],
        )
        session.add(subscription)
    else:
        if data.get("provider_customer_id"):
            subscription.provider_customer_id = data["provider_customer_id"]
        if data.get("provider_subscription_id"):
            subscription.provider_subscription_id = data["provider_subscription_id"]
        if data.get("provider_payment_id"):
            subscription.provider_payment_id = data["provider_payment_id"]
        subscription.plan_name = data["plan_name"]
        subscription.status = data["payment_status"]
        subscription.amount = data.get("amount")
        subscription.billing_cycle = data.get("billing_cycle")
        subscription.next_due_date = data.get("next_due_date")
        subscription.last_payment_date = data.get("last_payment_date")
        subscription.last_event = "PAYMENT_CONFIRMED"
        subscription.raw_payload = data["raw_payload"]
        subscription.updated_at = data["now"]


async def process_asaas_payment_confirmed(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Provisiona ou atualiza assinatura/tenant após PAYMENT_CONFIRMED.
    """
    payment = payload.get("payment") if isinstance(payload.get("payment"), dict) else {}

    external_reference = payment.get("externalReference") or payload.get(
        "externalReference"
    )
    tenant_id = str(external_reference or "").strip()
    if not tenant_id:
        return {"processed": False, "reason": "missing_external_reference"}
    if not _TENANT_ID_RE.fullmatch(tenant_id):
        return {"processed": False, "reason": "invalid_tenant_id"}

    plan_name = str(
        payment.get("plan")
        or payment.get("description")
        or payload.get("plan")
        or "pro"
    ).strip()[:64]

    amount = payment.get("value")
    try:
        amount = float(amount) if amount is not None else None
    except (TypeError, ValueError):
        amount = None
    if amount is not None and amount <= 0:
        return {"processed": False, "reason": "invalid_amount"}

    billing_cycle = payment.get("billingType")
    payment_status = str(payment.get("status") or "CONFIRMED")[:64]
    next_due_date = _parse_date(payment.get("dueDate"))
    last_payment_date = _parse_datetime(payment.get("paymentDate"))

    provider_customer_id = payment.get("customer")
    provider_subscription_id = payment.get("subscription")
    provider_payment_id = payment.get("id")

    async with get_session() as session:
        await _get_or_update_tenant(session, tenant_id, plan_name)
        subscription = await _find_asaas_subscription(
            session, tenant_id, provider_payment_id, provider_subscription_id
        )

        raw_payload = json.dumps(payload, ensure_ascii=False)
        max_payload = max(1, int(settings.billing.asaas_max_payload_bytes))
        if len(raw_payload.encode("utf-8")) > max_payload:
            raw_payload = raw_payload.encode("utf-8")[:max_payload].decode(
                "utf-8", errors="ignore"
            )
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        _upsert_subscription(
            session,
            subscription,
            tenant_id=tenant_id,
            provider_customer_id=provider_customer_id,
            provider_subscription_id=provider_subscription_id,
            provider_payment_id=provider_payment_id,
            plan_name=plan_name,
            payment_status=payment_status,
            amount=amount,
            billing_cycle=billing_cycle,
            next_due_date=next_due_date,
            last_payment_date=last_payment_date,
            raw_payload=raw_payload,
            now=now,
        )

    return {
        "processed": True,
        "tenant_id": tenant_id,
        "plan_name": plan_name,
        "status": payment_status,
    }


@router.post(
    "/asaas",
    responses={
        400: {"description": "Invalid JSON payload or missing event"},
        401: {"description": "Invalid Asaas webhook token"},
        413: {"description": "Payload too large"},
    },
)
async def asaas_webhook(request: Request):
    if not _is_valid_asaas_webhook(request):
        raise HTTPException(status_code=401, detail="Invalid Asaas webhook token")

    max_payload = max(1, int(settings.billing.asaas_max_payload_bytes))
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit():
        if int(content_length) > max_payload:
            raise HTTPException(status_code=413, detail="Payload too large")

    raw_body = await request.body()
    if len(raw_body) > max_payload:
        raise HTTPException(status_code=413, detail="Payload too large")

    try:
        payload = json.loads(raw_body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    event = str(payload.get("event") or "").strip()
    if not event:
        raise HTTPException(status_code=400, detail="Missing event in payload")

    if event != "PAYMENT_CONFIRMED":
        return {"success": True, "processed": False, "ignored_event": event}

    result = await process_asaas_payment_confirmed(payload)
    return {"success": True, **result}
