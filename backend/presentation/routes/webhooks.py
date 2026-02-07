import json
import secrets
from datetime import date, datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from backend.config.settings import settings
from backend.domain.sqlmodels import Subscription, Tenant
from backend.infrastructure.db_engine import get_session

router = APIRouter()


def _extract_asaas_token(request: Request) -> str | None:
    return request.headers.get("asaas-access-token") or request.headers.get("x-asaas-access-token")


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
        try:
            parsed = datetime.fromisoformat(raw[:19])
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
            return parsed
        except Exception:
            return None


async def process_asaas_payment_confirmed(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Provisiona ou atualiza assinatura/tenant após PAYMENT_CONFIRMED.
    """
    payment = payload.get("payment") if isinstance(payload.get("payment"), dict) else {}

    external_reference = payment.get("externalReference") or payload.get("externalReference")
    tenant_id = str(external_reference or "").strip()
    if not tenant_id:
        return {"processed": False, "reason": "missing_external_reference"}

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

    billing_cycle = payment.get("billingType")
    payment_status = str(payment.get("status") or "CONFIRMED")[:64]
    next_due_date = _parse_date(payment.get("dueDate"))
    last_payment_date = _parse_datetime(payment.get("paymentDate"))

    provider_customer_id = payment.get("customer")
    provider_subscription_id = payment.get("subscription")
    provider_payment_id = payment.get("id")

    async with get_session() as session:
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

        subscription = None
        if provider_subscription_id:
            result = await session.execute(
                select(Subscription).where(
                    Subscription.provider == "asaas",
                    Subscription.provider_subscription_id == provider_subscription_id,
                )
            )
            subscription = result.scalar_one_or_none()

        if not subscription:
            result = await session.execute(
                select(Subscription)
                .where(
                    Subscription.provider == "asaas",
                    Subscription.tenant_id == tenant_id,
                )
                .order_by(Subscription.updated_at.desc())
                .limit(1)
            )
            subscription = result.scalar_one_or_none()

        raw_payload = json.dumps(payload, ensure_ascii=False)
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        if not subscription:
            subscription = Subscription(
                tenant_id=tenant_id,
                provider="asaas",
                provider_customer_id=provider_customer_id,
                provider_subscription_id=provider_subscription_id,
                provider_payment_id=provider_payment_id,
                plan_name=plan_name,
                status=payment_status,
                amount=amount,
                billing_cycle=billing_cycle,
                next_due_date=next_due_date,
                last_payment_date=last_payment_date,
                last_event="PAYMENT_CONFIRMED",
                raw_payload=raw_payload,
                updated_at=now,
            )
            session.add(subscription)
        else:
            subscription.provider_customer_id = provider_customer_id or subscription.provider_customer_id
            subscription.provider_subscription_id = provider_subscription_id or subscription.provider_subscription_id
            subscription.provider_payment_id = provider_payment_id or subscription.provider_payment_id
            subscription.plan_name = plan_name
            subscription.status = payment_status
            subscription.amount = amount
            subscription.billing_cycle = billing_cycle
            subscription.next_due_date = next_due_date
            subscription.last_payment_date = last_payment_date
            subscription.last_event = "PAYMENT_CONFIRMED"
            subscription.raw_payload = raw_payload
            subscription.updated_at = now

    return {
        "processed": True,
        "tenant_id": tenant_id,
        "plan_name": plan_name,
        "status": payment_status,
    }


@router.post("/asaas")
async def asaas_webhook(request: Request):
    if not _is_valid_asaas_webhook(request):
        raise HTTPException(status_code=401, detail="Invalid Asaas webhook token")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event = str(payload.get("event") or "").strip()
    if not event:
        raise HTTPException(status_code=400, detail="Missing event in payload")

    if event != "PAYMENT_CONFIRMED":
        return {"success": True, "processed": False, "ignored_event": event}

    result = await process_asaas_payment_confirmed(payload)
    return {"success": True, **result}
