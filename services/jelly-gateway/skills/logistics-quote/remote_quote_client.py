#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REST quotation client for logistics-quote v1.2-dev."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

import requests

EUROPE_COUNTRY_TERMS = [
    "欧洲", "英国", "德国", "法国", "意大利", "西班牙", "荷兰", "波兰",
    "捷克", "瑞典", "比利时", "奥地利", "匈牙利", "欧盟",
]
EUROPE_CODES = {"MHG9", "DTM2", "DTM1", "BER8", "RLG1", "HAJ1", "WRO5"}
US_CODES = {"LAX9", "ABE8", "RDU2", "FTW1", "SMF3", "AVP1", "MDW2", "CLT2", "FWA4", "SCK4", "PSP3"}


def _remote_config(config: Dict[str, Any]) -> Dict[str, Any]:
    return config.get("remote_api", {}) or {}


def _join_url(base_url: str, endpoint: str) -> str:
    return base_url.rstrip("/") + "/" + endpoint.lstrip("/")


def _clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _first(data: Dict[str, Any], keys: List[str], default: Any = "") -> Any:
    for key in keys:
        if key in data and data[key] not in [None, ""]:
            return data[key]
    return default


def _to_float(value: Any) -> Optional[float]:
    if value in [None, ""]:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _display_channel_name(value: Any) -> str:
    text = _clean(value)
    # Keep raw channel data separately; this is only the WeCom display label.
    text = re.sub(r"^【[^】]+】\s*", "", text)
    transport_prefixes = [
        "美国海运",
        "美国空派",
        "美国空运",
        "美国铁路",
        "海运",
        "空运",
        "铁路",
    ]
    prefix_pattern = "|".join(re.escape(prefix) for prefix in transport_prefixes)
    return re.sub(rf"^(?:{prefix_pattern})\s*(?:·|-|:|：)\s*", "", text)


def _extract_code_from_text(text: Any) -> str:
    match = re.search(r"\b([A-Z]{2,5}\d{1,4})\b", _clean(text).upper())
    return match.group(1) if match else ""


def _country_from_service_country(value: Any) -> str:
    text = _clean(value)
    for country in EUROPE_COUNTRY_TERMS:
        if country in text and country not in ["欧洲", "欧盟"]:
            return country
    return ""


def _detect_region_from_row(item: Dict[str, Any], source_file: str, worksheet: str, service_country: str, warehouse_code: str) -> str:
    joined = " ".join(
        _clean(v)
        for v in [
            source_file,
            worksheet,
            service_country,
            item.get("国家或分区"),
            item.get("服务国家"),
            item.get("服务国家/地区"),
            item.get("服务区域"),
            item.get("渠道摘要"),
        ]
        if v not in [None, ""]
    )
    code = _clean(warehouse_code).upper() or _extract_code_from_text(service_country)
    if code in EUROPE_CODES or any(term in joined for term in EUROPE_COUNTRY_TERMS):
        return "EUROPE"
    if code in US_CODES or any(term in joined for term in ["美国", "美西", "美东", "美中"]):
        return "US"
    return "UNKNOWN"


def _infer_shipping_method(text: str) -> str:
    lowered = text.lower()
    if any(token in text for token in ["空派", "空运", "空卡"]) or "air" in lowered:
        return "空运"
    if any(token in text for token in ["海运", "海派", "海卡", "整柜", "慢船", "慢线", "普船", "船运", "散货", "以星", "美森"]):
        return "海运"
    if any(token in text for token in ["铁路", "欧铁"]):
        return "铁路"
    if any(token in text for token in ["卡航", "卡车航"]):
        return "卡航"
    return ""


def _infer_tax_type(text: str) -> str:
    if "按方包税" in text:
        return "按方包税"
    if any(token in text for token in ["不包税", "不含税", "自税", "递延"]):
        return "自税"
    if "包税" in text or "含税" in text:
        return "包税"
    return ""


def _normalize_tax_type(value: Any, joined_text: str) -> str:
    text = _clean(value)
    if text:
        if "按方包税" in text:
            return "按方包税"
        if any(token in text for token in ["不包税", "不含税", "自税", "递延"]):
            return "自税"
        if "包税" in text or "含税" in text:
            return "包税"
    return _infer_tax_type(joined_text)


def _infer_billing_method(option: Dict[str, Any]) -> str:
    joined = " ".join(str(v) for v in option.values() if v is not None)
    if any(token in joined for token in ["每KG", "/KG", "KG+", "计费重"]):
        return "按KG"
    if any(token in joined for token in ["每CBM", "/CBM", "方"]):
        return "按CBM"
    return ""


def check_rest_health(config: Dict[str, Any]) -> Dict[str, Any]:
    remote = _remote_config(config)
    base_url = remote.get("base_url", "")
    endpoint = remote.get("health_endpoint", "/health")
    timeout = int(remote.get("timeout_seconds", 30))
    url = _join_url(base_url, endpoint)
    try:
        response = requests.get(url, timeout=timeout)
        payload = response.json() if response.content else {}
        ok = response.ok and bool(payload.get("ok", True))
        return {
            "ok": ok,
            "url": url,
            "status_code": response.status_code,
            "data": payload,
            "error": "" if ok else response.text,
        }
    except requests.Timeout:
        return {"ok": False, "url": url, "status_code": None, "data": {}, "error": "请求超时"}
    except requests.RequestException as exc:
        return {"ok": False, "url": url, "status_code": None, "data": {}, "error": str(exc)}
    except ValueError as exc:
        return {"ok": False, "url": url, "status_code": response.status_code, "data": {}, "error": f"响应不是有效 JSON：{exc}"}


def build_rest_payload(extracted_fields: Dict[str, Any]) -> Dict[str, Any]:
    remote_zip_hints = extracted_fields.get("_warehouse_zip_hints", {}) or {}
    batch_codes = [str(code).upper() for code in extracted_fields.get("_batch_warehouse_codes", []) if str(code).strip()]
    warehouse_code = _clean(extracted_fields.get("warehouse_code")).upper()
    zipcode = _clean(extracted_fields.get("zipcode"))
    region = _clean(extracted_fields.get("quote_region")).upper()
    destination_parts = []
    if region == "EUROPE":
        for key in ["country", "route_area", "warehouse_code", "destination_port"]:
            value = _clean(extracted_fields.get(key))
            if value and value not in destination_parts:
                destination_parts.append(value)
    elif batch_codes:
        destination_parts = []
    elif zipcode:
        destination_parts.append(zipcode)
    elif warehouse_code and warehouse_code in remote_zip_hints:
        destination_parts.extend([warehouse_code, str(remote_zip_hints[warehouse_code])])
    elif warehouse_code:
        destination_parts.append(warehouse_code)
    else:
        for key in ["destination_port", "country", "route_area"]:
            value = _clean(extracted_fields.get(key))
            if value:
                destination_parts.append(value)

    route_parts = []
    if batch_codes:
        route_parts.append(" ".join(batch_codes))
    else:
        for key in ["warehouse_code", "route_area", "channel_name"]:
            value = _clean(extracted_fields.get(key))
            if value and value not in route_parts:
                route_parts.append(value)

    payload: Dict[str, Any] = {}
    if destination_parts:
        payload["目的地"] = " ".join(destination_parts)
    batch_weight = extracted_fields.get("_batch_query_weight_kg")
    if batch_weight is not None:
        payload["重量"] = float(batch_weight)
    elif extracted_fields.get("weight_kg") is not None:
        payload["重量"] = float(extracted_fields["weight_kg"])
    if extracted_fields.get("volume_cbm") is not None:
        payload["方数"] = float(extracted_fields["volume_cbm"])
    if extracted_fields.get("origin_warehouse"):
        payload["起运地"] = _clean(extracted_fields.get("origin_warehouse"))
    if route_parts:
        payload["仓库/航线"] = " ".join(route_parts)
    if extracted_fields.get("piece_count") is not None:
        payload["件数"] = int(extracted_fields["piece_count"])
    if extracted_fields.get("shipping_method"):
        payload["运输方式"] = _clean(extracted_fields.get("shipping_method"))
    if extracted_fields.get("tax_type"):
        payload["税务类型"] = _clean(extracted_fields.get("tax_type"))
    if extracted_fields.get("delivery_method"):
        payload["派送方式"] = _clean(extracted_fields.get("delivery_method"))

    optional_map = {
        "remote_area": "是否偏远地区",
        "private_residence": "是否私人住宅",
        "insurance": "是否保险",
        "is_fba": "是否FBA",
    }
    for internal_key, rest_key in optional_map.items():
        if extracted_fields.get(internal_key) not in [None, ""]:
            payload[rest_key] = extracted_fields[internal_key]
    return payload


def call_rest_quote(extracted_fields: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    remote = _remote_config(config)
    base_url = remote.get("base_url", "")
    endpoint = remote.get("quote_endpoint", "/v1/quote")
    timeout = int(remote.get("timeout_seconds", 30))
    url = _join_url(base_url, endpoint)

    fields_for_payload = dict(extracted_fields)
    fields_for_payload["_warehouse_zip_hints"] = remote.get("warehouse_zip_hints", {}) or {}
    payload = build_rest_payload(fields_for_payload)
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if remote.get("api_key"):
        headers["Authorization"] = f"Bearer {remote['api_key']}"

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=timeout)
        response.raise_for_status()
        response_json = response.json()
        options = normalize_remote_options(response_json)
        batch_results = normalize_remote_batch_response(response_json)
        return {
            "ok": True,
            "url": url,
            "status_code": response.status_code,
            "payload": payload,
            "response_json": response_json,
            "options": options,
            "batch_results": batch_results,
            "error": "",
            "error_type": "",
        }
    except requests.Timeout:
        return {"ok": False, "url": url, "payload": payload, "options": [], "batch_results": [], "error": "请求超时", "error_type": "timeout"}
    except requests.RequestException as exc:
        return {"ok": False, "url": url, "payload": payload, "options": [], "batch_results": [], "error": str(exc), "error_type": "backend_unavailable"}
    except ValueError as exc:
        return {"ok": False, "url": url, "payload": payload, "options": [], "batch_results": [], "error": f"响应不是有效 JSON：{exc}", "error_type": "invalid_response"}


def _normalize_option(item: Dict[str, Any], idx: int, warehouse_code: str = "") -> Dict[str, Any]:
    channel_summary = _first(item, ["渠道摘要", "channel_summary"], "")
    channel = _first(item, ["子渠道", "渠道名称", "渠道", "channel_name", "channel"], "")
    channel_name_raw = _clean(channel_summary or channel)
    channel_name = _display_channel_name(channel_name_raw)
    order_channel = _clean(_first(item, ["下单渠道", "order_channel", "子渠道"], ""))
    service_country = _clean(_first(item, ["服务国家", "服务国家/地区", "服务区域", "国家或分区", "国家/区域", "service_country"], ""))
    service_code = _extract_code_from_text(service_country)

    cost_price = _to_float(_first(item, ["单价_CNY每KG", "单价_CNY每CBM", "单价", "成本单价", "cost_price", "price"], None))
    billing_method = _first(item, ["计费方式", "billing_method"], "") or _infer_billing_method(item)
    price_unit = _first(item, ["价格单位", "price_unit"], "")
    if not price_unit:
        if "KG" in billing_method.upper():
            price_unit = "RMB/KG"
        elif "CBM" in billing_method.upper():
            price_unit = "RMB/CBM"

    joined_text = json.dumps(item, ensure_ascii=False)
    source_file = _clean(_first(item, ["来源报价表", "source_file", "source_name", "数据来源"], ""))
    worksheet = _clean(_first(item, ["工作簿", "工作表", "来源sheet", "source_sheet", "sheet", "worksheet"], ""))
    mapped_warehouse_code = warehouse_code or _clean(_first(item, ["仓库代码", "warehouse_code", "fba_warehouse", "FBA仓库", "FBA仓", "仓库", "仓点", "FBA仓点"], ""))
    if not mapped_warehouse_code and service_code:
        mapped_warehouse_code = service_code
    region = _detect_region_from_row(item, source_file, worksheet, service_country, mapped_warehouse_code)
    country = _clean(_first(item, ["国家", "country"], "")) or _country_from_service_country(service_country)
    return {
        "option_no": idx,
        "labels": [],
        "quote_region": region,
        "product_name": _clean(_first(item, ["产品名称", "渠道名称", "子渠道", "channel_product", "product_name"], "")),
        "channel_product": _clean(_first(item, ["渠道名称", "产品名称", "子渠道", "channel_product", "product_name"], "")),
        "order_channel": order_channel,
        "service_country": service_country,
        "channel_summary": _clean(channel_summary),
        "channel_name": _clean(channel_name),
        "channel_name_raw": channel_name_raw,
        "shipping_method": _clean(_first(item, ["运输方式", "shipping_method", "transport"], "")) or _infer_shipping_method(joined_text),
        "delivery_method": _clean(_first(item, ["派送方式", "delivery_method", "delivery_mode"], "")),
        "origin_warehouse": _clean(_first(item, ["起运仓", "起运地", "origin", "origin_warehouse"], "")),
        "tax_type": _normalize_tax_type(_first(item, ["税务类型", "税别", "tax_type"], ""), joined_text),
        "billing_method": _clean(billing_method),
        "cost_price": cost_price,
        "cost_price_display": "" if cost_price is None else str(cost_price),
        "currency": _clean(_first(item, ["币种", "currency"], "RMB")) or "RMB",
        "price_unit": _clean(price_unit),
        "reference_eta": _clean(_first(item, ["参考时效", "时效", "reference_eta", "eta", "transit_text"], "")),
        "ship_schedule": _clean(_first(item, ["船期", "ship_schedule"], "")),
        "eta_days": None,
        "data_source": source_file,
        "source_file": source_file,
        "source_name": source_file,
        "source_sheet": worksheet,
        "worksheet": worksheet,
        "source_row": _clean(_first(item, ["source_row", "原始行号", "row", "row_index"], "")),
        "rate_line_id": _clean(_first(item, ["rate_line_id", "rate_id", "报价行ID"], "")),
        "record_id": _clean(_first(item, ["record_id", "id", "记录ID"], "")),
        "warehouse_code": mapped_warehouse_code,
        "warehouse_name": _clean(_first(item, ["仓库名", "仓库名称", "warehouse_name"], "")),
        "zipcode": _clean(_first(item, ["邮编", "zipcode", "zip", "美国邮编_解析"], "")),
        "destination": _clean(_first(item, ["目的地", "destination"], "")),
        "country": country or _clean(_first(item, ["国家或分区"], "")),
        "route_area": _clean(_first(item, ["分区", "route_area", "国家或分区"], "")),
        "destination_port": _clean(_first(item, ["目的港", "destination_port"], "")),
        "weight_kg": _to_float(_first(item, ["重量", "weight_kg"], None)),
        "volume_cbm": _to_float(_first(item, ["方数", "cbm", "volume_cbm"], None)),
        "piece_count": _to_float(_first(item, ["件数", "pieces", "piece_count"], None)),
        "min_weight_kg": None,
        "max_weight_kg": None,
        "min_volume_cbm": None,
        "max_volume_cbm": None,
        "raw_remark": _clean(_first(item, ["备注摘要", "备注", "raw_remark"], "")),
        "raw": item,
    }


def _raw_option_list(container: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_options = _first(
        container,
        ["方案列表", "options", "quotes", "data", "results", "方案", "items"],
        [],
    )
    if isinstance(raw_options, dict):
        raw_options = raw_options.get("items") or raw_options.get("data") or []
    if not isinstance(raw_options, list):
        return []
    return [item for item in raw_options if isinstance(item, dict)]


def normalize_remote_options(response_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_options = _raw_option_list(response_json)

    normalized: List[Dict[str, Any]] = []
    for idx, item in enumerate(raw_options, 1):
        normalized.append(_normalize_option(item, idx))
    return normalized


def normalize_remote_batch_response(response_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_batch = _first(response_json, ["按FBA仓报价", "by_fba_warehouse", "by_warehouse", "batch_results"], [])
    if not isinstance(raw_batch, list):
        return []

    normalized_batch: List[Dict[str, Any]] = []
    for batch_idx, batch_item in enumerate(raw_batch, 1):
        if not isinstance(batch_item, dict):
            continue
        warehouse_code = _clean(_first(batch_item, ["fba_warehouse", "FBA仓", "仓库代码", "warehouse_code"], ""))
        raw_options = _raw_option_list(batch_item)
        options = [_normalize_option(item, idx, warehouse_code) for idx, item in enumerate(raw_options, 1)]
        normalized_batch.append(
            {
                "warehouse_code": warehouse_code,
                "chargeable_weight_kg": _to_float(_first(batch_item, ["计费重_kg", "chargeable_weight_kg"], None)),
                "zipcode": _clean(_first(batch_item, ["美国邮编_解析", "zipcode"], "")),
                "options": options,
                "recommended": _first(batch_item, ["推荐方案", "recommended"], None),
                "hints": _first(batch_item, ["提示", "hints"], []),
                "raw": batch_item,
                "batch_index": batch_idx,
            }
        )
    return normalized_batch
