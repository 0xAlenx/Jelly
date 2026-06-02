#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stateful logistics quotation CLI.

Usage:
  python quote_query.py "LAX9，300kg，深圳仓，包税，有什么方案？"
  python quote_query.py "统一按15%"
  python quote_query.py "/当前任务"
"""

from __future__ import annotations

import json
import math
import re
import sys
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "quote_config.json"
REMOTE_FAIL_CLOSED_MESSAGE = "当前报价数据库暂时无法查询，为避免报价错误，暂不生成报价，请稍后重试或联系负责人确认最新价格。"

STATUSES = {
    "IN_PROGRESS": "In Progress",
    "WAITING_INFO": "Waiting for More Information",
    "COST_OPTIONS": "Cost Options Generated",
    "WAITING_MARGIN": "Waiting for Margin Rate",
    "FINAL": "Final Quote Generated",
    "INTERRUPTED": "Interrupted",
    "COMPLETED": "Completed",
}

FIELD_ALIASES = {
    "quote_version": ["版本", "报价版本", "quote_version"],
    "source_file": ["source_file", "来源文件", "文件名"],
    "source_sheet": ["source_sheet", "sheet", "工作表", "来源sheet"],
    "region": ["region", "区域", "大区"],
    "country": ["country", "国家", "目的国"],
    "route_area": ["route_area", "路线区域", "分区", "区域"],
    "destination_port": ["destination_port", "目的港", "港口"],
    "warehouse_code": ["warehouse_code", "仓库代码", "仓库编码", "FBA仓", "仓编"],
    "warehouse_code_raw": ["warehouse_code_raw", "原始仓库代码"],
    "warehouse_name": ["warehouse_name", "仓库名称"],
    "state": ["state", "州", "省州"],
    "zipcode": ["zipcode", "zip", "邮编"],
    "channel_name": ["channel_name", "渠道", "渠道名称"],
    "channel_code": ["channel_code", "渠道代码"],
    "shipping_method": ["shipping_method", "运输方式", "头程方式"],
    "delivery_method": ["delivery_method", "派送方式", "尾程方式"],
    "origin_warehouse": ["origin_warehouse", "起运仓", "发货仓", "起运地"],
    "tax_type": ["tax_type", "税务类型", "税别", "包税类型"],
    "billing_method": ["billing_method", "计费方式"],
    "price_unit": ["price_unit", "价格单位", "单位"],
    "min_weight_kg": ["min_weight_kg", "最低重量", "起始重量", "重量下限"],
    "max_weight_kg": ["max_weight_kg", "最高重量", "重量上限"],
    "min_volume_cbm": ["min_volume_cbm", "最低体积", "体积下限"],
    "max_volume_cbm": ["max_volume_cbm", "最高体积", "体积上限"],
    "cost_price": ["cost_price", "成本价", "价格", "单价", "成本单价"],
    "currency": ["currency", "币种"],
    "reference_eta": ["reference_eta", "时效", "参考时效"],
    "raw_remark": ["raw_remark", "备注", "说明"],
    "is_active": ["is_active", "是否有效"],
}

EXTRACT_FIELDS = [
    "country",
    "route_area",
    "destination_port",
    "warehouse_code",
    "warehouse_name",
    "state",
    "zipcode",
    "channel_name",
    "shipping_method",
    "delivery_method",
    "origin_warehouse",
    "tax_type",
    "billing_method",
    "weight_kg",
    "volume_cbm",
    "piece_count",
    "time_preference",
    "cargo_type",
    "special_notes",
]

CORE_FIELDS = {
    "warehouse_code",
    "country",
    "route_area",
    "weight_kg",
    "volume_cbm",
    "origin_warehouse",
    "tax_type",
    "shipping_method",
    "billing_method",
}


@dataclass
class LoadReport:
    loaded_files: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    detected_columns: Dict[str, List[str]] = field(default_factory=dict)
    filtering_steps: List[Tuple[str, int]] = field(default_factory=list)
    zero_filter: str = ""
    no_match_type: str = ""
    no_match_reason: str = ""
    remote_error: str = ""
    remote_error_type: str = ""
    remote_url: str = ""
    remote_payload: Dict[str, Any] = field(default_factory=dict)


def now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def load_config() -> Dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {
            "debug": False,
            "query_mode": "rest",
            "allow_excel_fallback": False,
            "max_display_options": 20,
            "max_options_display_stage1": 10,
            "max_options_display_stage2": 10,
            "max_customer_options": 5,
            "session_file": "quote_sessions.json",
        }
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def session_path(config: Dict[str, Any]) -> Path:
    return BASE_DIR / config.get("session_file", "quote_sessions.json")


def load_sessions(config: Dict[str, Any]) -> Dict[str, Any]:
    path = session_path(config)
    if not path.exists():
        return {"active_task_id": None, "tasks": []}
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("active_task_id", None)
    data.setdefault("tasks", [])
    if isinstance(data["tasks"], dict):
        data["tasks"] = list(data["tasks"].values())
    return data


def save_sessions(config: Dict[str, Any], sessions: Dict[str, Any]) -> None:
    path = session_path(config)
    with path.open("w", encoding="utf-8") as f:
        json.dump(sessions, f, ensure_ascii=False, indent=2)


def reset_sessions_file(config: Dict[str, Any]) -> None:
    path = session_path(config)
    with path.open("w", encoding="utf-8") as f:
        json.dump({"active_task_id": None, "tasks": {}}, f, ensure_ascii=False, indent=2)


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip()
    text = text.replace("\u3000", "")
    text = re.sub(r"\s+", "", text)
    text = text.replace("（", "(").replace("）", ")")
    return text


def norm_for_match(value: Any) -> str:
    return normalize_text(value).lower()


def to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).strip()
    if not text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def format_money(value: Any) -> str:
    num = to_float(value)
    if num is None:
        return ""
    if abs(num - round(num)) < 0.000001:
        return str(int(round(num)))
    return f"{num:.2f}".rstrip("0").rstrip(".")


def format_amount(value: Any) -> str:
    num = to_float(value)
    if num is None:
        return ""
    return str(Decimal(str(num)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def to_decimal(value: Any) -> Optional[Decimal]:
    if value in [None, ""]:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        num = to_float(value)
        return Decimal(str(num)) if num is not None else None


def ceil_to_1_decimal(value: Any) -> Optional[Decimal]:
    amount = to_decimal(value)
    if amount is None:
        return None
    return ((amount * Decimal("10")).to_integral_value(rounding=ROUND_CEILING) / Decimal("10")).quantize(Decimal("0.0"))


def format_1_decimal(value: Any) -> str:
    amount = to_decimal(value)
    if amount is None:
        return ""
    return str(amount.quantize(Decimal("0.0"), rounding=ROUND_HALF_UP))


def customer_quote_line(currency: str, amount: Any, price_unit: Any = "", billing_method: Any = "") -> str:
    value = format_1_decimal(amount)
    if not value:
        return ""
    return f"{currency or 'RMB'} {value}{unit_suffix(price_unit, billing_method)}"


def customer_total_line(currency: str, amount: Any) -> str:
    value = format_1_decimal(amount)
    if not value:
        return ""
    return f"{currency or 'RMB'} {value}"


def display_status(status: str) -> str:
    mapping = {
        STATUSES["IN_PROGRESS"]: "处理中",
        STATUSES["WAITING_INFO"]: "等待补充信息",
        STATUSES["COST_OPTIONS"]: "已生成成本方案",
        STATUSES["WAITING_MARGIN"]: "等待输入毛利率",
        STATUSES["FINAL"]: "已生成最终报价",
        STATUSES["INTERRUPTED"]: "已中断",
        STATUSES["COMPLETED"]: "已结束",
    }
    return mapping.get(status, status or "")


def command_help() -> str:
    return """【常用命令】
- /当前任务：查看当前报价任务
- /任务列表：查看最近报价任务
- /切换任务 任务编号：切换到历史任务
- /中断并新开：中断当前任务并开启新询价
- /结束任务：结束当前任务"""


def label_text(labels: List[str]) -> str:
    mapping = {"Best Cost": "性价比最高", "Fastest ETA": "时效最快"}
    return " / ".join(mapping.get(label, label) for label in labels if label)


def unit_suffix(price_unit: Any, billing_method: Any = "") -> str:
    unit = normalize_text(price_unit).upper()
    billing = normalize_text(billing_method).upper()
    if "KG" in unit or "KG" in billing:
        return " / KG"
    if "CBM" in unit or "方" in billing:
        return " / CBM"
    if unit and "/" in unit:
        return " / " + unit.split("/", 1)[1].strip()
    return ""


def cost_line(currency: str, amount: Any, price_unit: Any = "", billing_method: Any = "") -> str:
    value = format_amount(amount)
    if not value:
        return ""
    return f"{currency or 'RMB'} {value}{unit_suffix(price_unit, billing_method)}"


def source_title(file_name: str) -> str:
    stem = Path(file_name).stem
    return stem.split("_成本表", 1)[0]


def show(value: Any) -> str:
    if value is None:
        return "未填写"
    if isinstance(value, float) and math.isnan(value):
        return "未填写"
    text = str(value).strip()
    return text if text else "未填写"


def show_returned(value: Any) -> str:
    if value is None:
        return "未返回"
    if isinstance(value, float) and math.isnan(value):
        return "未返回"
    text = str(value).strip()
    return text if text else "未返回"


def first_display_value(record: Dict[str, Any], keys: List[str]) -> Any:
    for key in keys:
        value = record.get(key)
        if value not in [None, ""]:
            return value
    return ""


def ship_schedule_display(value: Any) -> str:
    text = str(value).strip() if value not in [None, ""] else ""
    return text or "未返回"


def _display_part(value: Any) -> str:
    text = normalize_text(value)
    return "" if text in ["未填写", "未返回"] else text


def is_generic_channel_name(value: Any) -> bool:
    text = _display_part(value)
    if not text:
        return True
    text = re.sub(r"^【[^】]+】\s*", "", text)
    compact = re.sub(r"\s+", "", text)
    generic_patterns = [
        r"^(?:欧洲/英国|欧洲|英国)?成本表\s*[·\-:：]\s*(?:海运|铁路|空运|卡航)$",
        r"^(?:欧洲/英国|欧洲|英国)?(?:海运|铁路|空运|卡航)$",
    ]
    return any(re.search(pattern, compact) for pattern in generic_patterns)


def display_channel_path(record: Dict[str, Any]) -> str:
    region = detect_quote_region({}, "", record)
    if region == "EUROPE":
        order_channel = _display_part(first_display_value(record, ["order_channel", "channel_product", "product_name"]))
        service_country = _display_part(record.get("service_country"))
        warehouse_code = _display_part(first_display_value(record, ["batch_warehouse_code", "warehouse_code"]))
        def with_code(path: str) -> str:
            if warehouse_code and warehouse_code.upper() not in path.upper():
                return f"{path} {warehouse_code}".strip()
            return path

        if order_channel and service_country:
            return with_code(f"{order_channel} {service_country}")
        if order_channel and warehouse_code:
            return f"{order_channel} {warehouse_code}"
        if service_country:
            worksheet = _display_part(first_display_value(record, ["worksheet", "source_sheet"]))
            return with_code(f"{worksheet} {service_country}".strip())
    if region == "US":
        product = _display_part(first_display_value(record, ["product_name", "channel_product"]))
        warehouse_code = _display_part(first_display_value(record, ["batch_warehouse_code", "warehouse_code"]))
        channel = _display_part(record.get("channel_name"))
        worksheet = _display_part(first_display_value(record, ["worksheet", "source_sheet"]))
        if product and warehouse_code:
            return f"{product}｜{warehouse_code}"
        if channel and warehouse_code:
            return f"{channel}｜{warehouse_code}"
        if worksheet and warehouse_code:
            return f"{worksheet}｜{warehouse_code}"

    parts: List[str] = []

    def add(value: Any) -> None:
        text = _display_part(value)
        if text and text not in parts:
            parts.append(text)

    add(first_display_value(record, ["batch_warehouse_code", "warehouse_code"]))
    add(first_display_value(record, ["requested_country", "country", "requested_route_area", "route_area"]))
    add(record.get("warehouse_name"))
    add(first_display_value(record, ["worksheet", "source_sheet"]))

    raw_channel = first_display_value(record, ["channel_name_raw", "raw_channel_name", "channel_name"])
    cleaned_channel = record.get("channel_name")
    if not is_generic_channel_name(raw_channel):
        add(raw_channel)
    elif not is_generic_channel_name(cleaned_channel):
        add(cleaned_channel)

    add(record.get("shipping_method"))
    add(record.get("tax_type"))
    add(record.get("delivery_method"))
    add(first_display_value(record, ["batch_weight_display", "weight_display"]))
    add(record.get("zipcode"))
    add(record.get("destination"))
    return "｜".join(parts) if parts else show_returned(record.get("channel_name"))


def trace_detail_lines(record: Dict[str, Any]) -> List[str]:
    lines: List[str] = []
    trace_fields = [
        ("仓库代码", first_display_value(record, ["batch_warehouse_code", "warehouse_code"])),
        ("仓库名", record.get("warehouse_name")),
        ("邮编", record.get("zipcode")),
        ("原始行号", first_display_value(record, ["source_row", "row_index", "rate_line_id", "record_id"])),
    ]
    for label, value in trace_fields:
        text = _display_part(value)
        if text:
            lines.append(f"{label}：{text}")
    return lines


def quantity_detail_lines(record: Dict[str, Any]) -> List[str]:
    lines: List[str] = []
    weight_display = first_display_value(record, ["batch_weight_display", "weight_display"])
    weight = first_display_value(record, ["batch_weight_kg", "weight_kg"])
    volume = first_display_value(record, ["batch_volume_cbm", "volume_cbm"])
    pieces = first_display_value(record, ["piece_count"])
    if weight_display not in [None, ""]:
        lines.append(f"重量：{weight_display}")
    elif weight not in [None, ""]:
        lines.append(f"重量：{format_money(weight)} KG")
    else:
        lines.append("重量：未返回")
    if volume not in [None, ""]:
        lines.append(f"体积：{format_money(volume)} CBM")
    else:
        lines.append("体积：未返回")
    if pieces not in [None, ""]:
        lines.append(f"件数：{format_money(pieces)}")
    else:
        lines.append("件数：未返回")
    return lines


def option_detail_lines(record: Dict[str, Any], include_quote: bool = False) -> List[str]:
    origin_display = record.get("origin_warehouse") or "未返回"
    lines = [
        f"来源报价表：{show_returned(first_display_value(record, ['source_file', 'source_name', 'data_source']))}",
        f"工作簿：{show_returned(first_display_value(record, ['worksheet', 'source_sheet']))}",
        f"渠道：{show_returned(display_channel_path(record))}",
    ]
    lines.extend(trace_detail_lines(record))
    lines.extend([
        f"运输方式：{show_returned(record.get('shipping_method'))}",
        f"起运仓：{origin_display}",
        f"税务类型：{show_returned(record.get('tax_type'))}",
        f"计费方式：{show_returned(record.get('billing_method'))}",
        f"成本单价：{show_returned(cost_line(record.get('currency', 'RMB'), record.get('cost_price'), record.get('price_unit'), record.get('billing_method')))}",
    ])
    if include_quote:
        lines.append(f"报价单价：{show_returned(customer_quote_line(record.get('currency', 'RMB'), record.get('final_unit_price'), record.get('price_unit'), record.get('billing_method')))}")
    lines.extend(quantity_detail_lines(record))
    if include_quote:
        total = record.get("estimated_total_display")
        if record.get("estimated_total") is not None:
            total = customer_total_line(record.get('currency', 'RMB'), record.get('estimated_total'))
        lines.append(f"预估总价：{show_returned(total)}")
    lines.extend(
        [
            f"参考时效：{eta_display(record.get('reference_eta'))}",
            f"船期：{ship_schedule_display(record.get('ship_schedule'))}",
        ]
    )
    return lines


def customer_label_text(labels: List[str]) -> str:
    mapping = {"Best Cost": "性价比较高", "Fastest ETA": "时效更快"}
    return " / ".join(mapping.get(label, label) for label in labels if label)


def customer_header_label(labels: List[str]) -> str:
    mapping = {"Best Cost": "性价比最高", "Fastest ETA": "时效最快"}
    return "｜".join(mapping.get(label, label) for label in labels if label)


def quote_quantity_header(record: Dict[str, Any]) -> str:
    parts: List[str] = []
    weight = first_display_value(record, ["batch_weight_kg", "weight_kg"])
    volume = first_display_value(record, ["batch_volume_cbm", "volume_cbm"])
    pieces = first_display_value(record, ["piece_count"])
    if weight not in [None, ""]:
        parts.append(f"{format_money(weight)}KG")
    if volume not in [None, ""]:
        parts.append(f"{format_money(volume)}CBM")
    if pieces not in [None, ""]:
        parts.append(f"{format_money(pieces)}件")
    return " / ".join(parts)


def customer_quote_heading(record: Dict[str, Any]) -> str:
    location = first_display_value(record, ["batch_warehouse_code", "warehouse_code", "destination", "route_area", "country"])
    quantity = quote_quantity_header(record)
    if location and quantity:
        return f"{location}｜{quantity}"
    return str(location or quantity or "")


def get_task(sessions: Dict[str, Any], task_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not task_id:
        return None
    for task in sessions.get("tasks", []):
        if task.get("task_id") == task_id:
            return task
    return None


def active_task(sessions: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return get_task(sessions, sessions.get("active_task_id"))


def next_task_id(sessions: Dict[str, Any]) -> str:
    date_part = datetime.now().strftime("%Y%m%d")
    prefix = f"Q-{date_part}-"
    nums = []
    for task in sessions.get("tasks", []):
        tid = task.get("task_id", "")
        if tid.startswith(prefix):
            try:
                nums.append(int(tid.rsplit("-", 1)[-1]))
            except ValueError:
                pass
    return f"{prefix}{(max(nums) + 1 if nums else 1):03d}"


def add_change(task: Dict[str, Any], action: str, details: Any) -> None:
    task.setdefault("change_log", []).append(
        {"time": now_iso(), "action": action, "details": details}
    )
    task["updated_at"] = now_iso()


def parse_eta_days(value: Any) -> Optional[float]:
    text = normalize_text(value)
    if not text:
        return None
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", text)]
    if not nums:
        return None
    if len(nums) >= 2 and re.search(r"[-~至到]", text):
        return sum(nums[:2]) / 2.0
    return nums[0]


def eta_display(value: Any) -> str:
    text = str(value).strip() if value not in [None, ""] else ""
    return text or "未返回"


WAREHOUSE_CODE_PATTERN = re.compile(r"\b([A-Za-z]{2,5}\d{1,4})\b", re.IGNORECASE)
EUROPE_COUNTRY_TERMS = [
    "欧洲", "英国", "德国", "法国", "意大利", "西班牙", "荷兰", "波兰",
    "捷克", "瑞典", "比利时", "奥地利", "匈牙利", "欧盟",
]
EUROPE_CODES = {"MHG9", "DTM2", "DTM1", "BER8", "RLG1", "HAJ1", "WRO5"}
US_CODES = {"LAX9", "ABE8", "RDU2", "FTW1", "SMF3", "AVP1", "MDW2", "CLT2", "FWA4", "SCK4", "PSP3"}


def extract_warehouse_codes(message: str) -> List[str]:
    codes: List[str] = []
    seen = set()
    for match in WAREHOUSE_CODE_PATTERN.finditer(message):
        code = match.group(1).upper()
        if code in seen:
            continue
        seen.add(code)
        codes.append(code)
    return codes


def detect_quote_region(parsed_query: Dict[str, Any], raw_text: str = "", backend_option: Optional[Dict[str, Any]] = None) -> str:
    values: List[str] = [raw_text]
    codes = [normalize_text(parsed_query.get("warehouse_code")).upper()]
    codes.extend(str(code).upper() for code in parsed_query.get("warehouse_codes", []) if str(code).strip())
    if backend_option:
        requested_region = normalize_text(backend_option.get("requested_quote_region")).upper()
        if requested_region in ["US", "EUROPE"]:
            return requested_region
        codes.append(normalize_text(backend_option.get("warehouse_code")).upper())
        raw = backend_option.get("raw") or {}
        values.extend(
            str(v)
            for v in [
                backend_option.get("source_file"),
                backend_option.get("source_name"),
                backend_option.get("worksheet"),
                backend_option.get("source_sheet"),
                backend_option.get("service_country"),
                backend_option.get("country"),
                backend_option.get("route_area"),
                raw.get("服务国家"),
                raw.get("服务国家/地区"),
                raw.get("服务区域"),
                raw.get("国家或分区"),
                raw.get("渠道摘要"),
            ]
            if v not in [None, ""]
        )
    text = normalize_text(" ".join(values))
    if any(code in EUROPE_CODES for code in codes) or any(term in text for term in EUROPE_COUNTRY_TERMS):
        return "EUROPE"
    if any(code in US_CODES for code in codes) or any(term in text for term in ["美国", "美西", "美东", "美中", "美国仓"]):
        return "US"
    return "UNKNOWN"


def parse_weight_expression(message: str) -> Dict[str, Any]:
    pattern = re.compile(
        r"(\d+(?:\.\d+)?)\s*(?:kg|KG|公斤|千克)\s*(以上货|以上|起|\+)?",
        re.IGNORECASE,
    )
    match = pattern.search(message)
    if not match:
        return {}
    weight = float(match.group(1))
    result: Dict[str, Any] = {"weight_kg": weight}
    suffix = normalize_text(match.group(2))
    if suffix:
        result["weight_condition"] = "gte"
        result["weight_display"] = f"{format_money(weight)}KG以上"
    else:
        result["weight_display"] = f"{format_money(weight)}KG"
    return result


def detect_explicit_shipping_filter(message: str) -> Tuple[str, str]:
    """Return (include_shipping_method, exclude_shipping_method)."""
    text = normalize_text(message)
    lower = text.lower()
    if any(k in text for k in ["不要空运", "不走空运", "不用空运", "排除空运"]):
        return "", "空运"
    if any(k in text for k in ["不要海运", "不走海运", "不用海运", "排除海运", "不要慢船", "不走慢船"]):
        return "", "海运"

    explicit_prefixes = ["只看", "只要", "仅看", "仅要", "只走", "只发", "只能", "指定", "限定", "必须"]
    if any(f"{prefix}{token}" in text for prefix in explicit_prefixes for token in ["空运", "空派", "空卡"]):
        return "空运", ""
    if any(f"{prefix}{token}" in text for prefix in explicit_prefixes for token in ["海运", "海派", "海卡", "慢船"]):
        return "海运", ""
    if any(f"{prefix}{token}" in text for prefix in explicit_prefixes for token in ["铁路", "欧铁"]):
        return "铁路", ""
    if any(f"{prefix}{token}" in text for prefix in explicit_prefixes for token in ["卡航", "卡车航"]):
        return "卡航", ""
    if any(k in text for k in ["走海运", "发海运", "海运", "海卡"]):
        return "海运", ""
    if any(k in text for k in ["走铁路", "发铁路", "铁路"]):
        return "铁路", ""
    if any(k in text for k in ["走空运", "发空运", "空运", "空派"]):
        return "空运", ""
    if "卡航" in text:
        return "卡航", ""
    if re.search(r"\bair\s*(?:only|freight\s*only)\b", lower):
        return "空运", ""
    if re.search(r"\b(?:sea|ocean)\s*(?:only|freight\s*only)\b", lower):
        return "海运", ""
    return "", ""


def extract_explicit_origin_warehouse(message: str) -> str:
    text = normalize_text(message)
    combo_origins = ["深圳/东莞/中山", "宁波/义乌"]
    for origin in combo_origins:
        if origin in text:
            return origin

    ordered_origins = ["深圳", "东莞", "中山", "长沙", "宁波", "义乌", "广州", "上海"]
    present = [origin for origin in ordered_origins if origin in text]
    if not present:
        return ""
    if set(["深圳", "东莞", "中山"]).issubset(set(present)):
        return "深圳/东莞/中山"
    if set(["宁波", "义乌"]).issubset(set(present)):
        return "宁波/义乌"
    return "/".join(present)


def extract_batch_items(message: str) -> List[Dict[str, Any]]:
    pattern = re.compile(
        r"\b([A-Za-z]{2,5}\d{1,4})\b\s*(?:[-—–:：|]|\s){1,10}\s*(\d+(?:\.\d+)?)\s*(?:kg|KG|公斤|千克)\b",
        re.IGNORECASE,
    )
    items: List[Dict[str, Any]] = []
    seen = set()
    for match in pattern.finditer(message):
        code = match.group(1).upper()
        weight = float(match.group(2))
        key = (code, weight)
        if key in seen:
            continue
        seen.add(key)
        items.append({"warehouse_code": code, "weight_kg": weight, "weight_display": f"{format_money(weight)}KG"})
    if len(items) >= 2:
        return items

    codes = extract_warehouse_codes(message)
    weight_info = parse_weight_expression(message)
    if len(codes) >= 2 and weight_info.get("weight_kg") is not None:
        return [
            {
                "warehouse_code": code,
                "weight_kg": weight_info["weight_kg"],
                "weight_condition": weight_info.get("weight_condition", ""),
                "weight_display": weight_info.get("weight_display", f"{format_money(weight_info['weight_kg'])}KG"),
            }
            for code in codes
        ]
    return items


def is_batch_inquiry(message: str) -> bool:
    return len(extract_batch_items(message)) >= 2


def batch_base_fields(fields: Dict[str, Any]) -> Dict[str, Any]:
    base = deepcopy(fields)
    base.pop("warehouse_code", None)
    base.pop("weight_kg", None)
    base.pop("zipcode", None)
    return base


def extract_fields(message: str, prefer_last_code: bool = False) -> Dict[str, Any]:
    text = normalize_text(message)
    lower = text.lower()
    fields: Dict[str, Any] = {}

    codes = extract_warehouse_codes(message)
    if codes:
        fields["warehouse_code"] = (codes[-1] if prefer_last_code else codes[0]).upper()
        if len(codes) >= 2:
            fields["warehouse_codes"] = codes

    weight_info = parse_weight_expression(message)
    if weight_info:
        fields.update(weight_info)

    volume = re.search(r"(\d+(?:\.\d+)?)\s*(?:方|立方|CBM|cbm|m3|M3)", message)
    if volume:
        fields["volume_cbm"] = float(volume.group(1))

    pieces = re.search(r"(\d+)\s*(?:件|箱|票|pcs|PCS)", message)
    if pieces:
        fields["piece_count"] = int(pieces.group(1))

    zipcode = re.search(r"\b\d{5}(?:-\d{4})?\b", message)
    if zipcode:
        fields["zipcode"] = zipcode.group(0)

    country_keywords = [
        "美国", "英国", "德国", "法国", "意大利", "西班牙", "波兰", "荷兰", "比利时",
        "捷克", "瑞典", "奥地利", "加拿大", "墨西哥", "日本", "澳大利亚",
    ]
    for country in country_keywords:
        if country in text:
            fields["country"] = country
            break
    if "UK" in message or "United Kingdom" in message or "Britain" in message:
        fields["country"] = "英国"
    if "USA" in message or "US" in message or "America" in message:
        fields["country"] = "美国"

    for area in ["美西", "美东", "美中", "欧洲", "英国", "欧盟"]:
        if area in text:
            fields["route_area"] = area

    port_keywords = ["洛杉矶", "长滩", "鹿特丹", "安特卫普", "汉堡", "费利克斯托"]
    for port in port_keywords:
        if port in text:
            fields["destination_port"] = port
            break

    explicit_origin = extract_explicit_origin_warehouse(message)
    if explicit_origin:
        fields["origin_warehouse"] = explicit_origin
        fields["_origin_warehouse_explicit"] = True

    if any(k in text for k in ["不包税", "不含税", "non-tax", "notax"]):
        fields["tax_type"] = "不包税"
    elif "按方包税" in text:
        fields["tax_type"] = "按方包税"
    elif "包税" in text or "含税" in text:
        fields["tax_type"] = "包税"
    elif "自税" in text:
        fields["tax_type"] = "自税"

    shipping_filter, excluded_shipping = detect_explicit_shipping_filter(message)
    if shipping_filter:
        fields["shipping_method"] = shipping_filter
    if excluded_shipping:
        fields["_exclude_shipping_method"] = excluded_shipping
    if "卡航" in text or "卡车" in text:
        fields["shipping_method"] = "卡航"

    if "卡派" in text or "海卡" in text:
        fields["delivery_method"] = "卡派"
    elif "快递派" in text or "快递" in text:
        fields["delivery_method"] = "快递派"
    elif "直送" in text:
        fields["delivery_method"] = "直送"

    if re.search(r"按\s*(?:kg|KG|公斤|千克)", message):
        fields["billing_method"] = "按KG"
    elif re.search(r"按\s*(?:方|立方|CBM|cbm)", message):
        fields["billing_method"] = "按CBM"

    if any(k in text for k in ["便宜", "性价比", "价格优先", "成本优先"]):
        fields["time_preference"] = "Best Cost"
    elif any(k in text for k in ["快", "时效优先", "加急", "faster", "fastest", "urgent"]):
        fields["time_preference"] = "Fastest ETA"

    if any(k in text for k in ["普货", "带电", "敏感货", "超长", "超重", "特殊货"]):
        fields["cargo_type"] = "特殊/需确认" if any(k in text for k in ["带电", "敏感", "超长", "超重", "特殊"]) else "普货"
    if re.search(r"\bFBA\b", message, re.IGNORECASE):
        fields["is_fba"] = True

    notes = []
    if any(k in text for k in ["偏远", "保险", "提货", "货拉拉", "附加费", "特殊"]):
        notes.append("包含需人工确认事项")
    if notes:
        fields["special_notes"] = "；".join(notes)

    fields["quote_region"] = detect_quote_region(fields, message)

    return fields


def is_modification_message(message: str) -> bool:
    text = normalize_text(message).lower()
    keywords = [
        "改", "换", "不是", "不对", "变更", "改成", "改为", "补充", "追加",
        "also", "too", "change", "changed", "not ", "instead", "还是用", "仍然用",
    ]
    return any(k in text for k in keywords)


def is_margin_message(message: str) -> bool:
    text = normalize_text(message).lower()
    return bool(re.search(r"\d+(?:\.\d+)?\s*%", message)) and any(
        k in text for k in ["毛利", "利润", "按", "apply", "use", "option", "方案", "统一", "只计算", "calculate", "margin"]
    )


def has_specific_destination(fields: Dict[str, Any]) -> bool:
    if fields.get("is_fba") and fields.get("shipping_method") == "空运":
        return True
    return any(
        fields.get(key)
        for key in [
            "warehouse_code",
            "warehouse_name",
            "destination_port",
            "zipcode",
            "state",
            "delivery_method",
        ]
    )


def sort_and_label_option_list(options: List[Dict[str, Any]], fields: Dict[str, Any], max_display: int) -> Tuple[List[Dict[str, Any]], int, bool]:
    if not options:
        return [], 0, False

    normalized = []
    for option in options:
        opt = deepcopy(option)
        opt["labels"] = []
        if opt.get("eta_days") is None:
            opt["eta_days"] = parse_eta_days(opt.get("reference_eta"))
        normalized.append(opt)

    def sort_key(opt: Dict[str, Any]) -> Tuple[float, float]:
        cost = opt.get("cost_price")
        eta = opt.get("eta_days")
        cost_sort = float(cost) if cost is not None else float("inf")
        eta_sort = float(eta) if eta is not None else float("inf")
        if fields.get("time_preference") == "Fastest ETA":
            return (eta_sort, cost_sort)
        return (cost_sort, eta_sort)

    normalized.sort(key=sort_key)
    for idx, option in enumerate(normalized, 1):
        option["option_no"] = idx

    valid_cost = [o for o in normalized if o.get("cost_price") is not None]
    if valid_cost:
        best = min(o["cost_price"] for o in valid_cost)
        for option in normalized:
            if option.get("cost_price") == best:
                option["labels"].append("Best Cost")

    valid_eta = [o for o in normalized if o.get("eta_days") is not None]
    if valid_eta:
        fastest = min(o["eta_days"] for o in valid_eta)
        for option in normalized:
            if option.get("eta_days") == fastest:
                option["labels"].append("Fastest ETA")

    total = len(normalized)
    return normalized, total, total > max_display


def remote_option_text(option: Dict[str, Any]) -> str:
    values = [
        option.get("channel_name", ""),
        option.get("channel_name_raw", ""),
        option.get("channel_summary", ""),
        option.get("product_name", ""),
        option.get("channel_product", ""),
        option.get("order_channel", ""),
        option.get("service_country", ""),
        option.get("warehouse_code", ""),
        option.get("destination", ""),
        option.get("zipcode", ""),
        option.get("shipping_method", ""),
        option.get("delivery_method", ""),
        option.get("origin_warehouse", ""),
        option.get("tax_type", ""),
        option.get("billing_method", ""),
        option.get("reference_eta", ""),
        option.get("ship_schedule", ""),
        option.get("raw_remark", ""),
    ]
    raw = option.get("raw")
    if raw:
        values.append(json.dumps(raw, ensure_ascii=False))
    return normalize_text(" ".join(str(v) for v in values if v is not None))


def option_source_text(option: Dict[str, Any]) -> str:
    raw = option.get("raw") or {}
    raw_values = []
    if isinstance(raw, dict):
        raw_values = list(raw.values())
    values = [
        option.get("worksheet", ""),
        option.get("source_sheet", ""),
        option.get("source_file", ""),
        option.get("source_name", ""),
        option.get("channel_name", ""),
        option.get("channel_summary", ""),
        option.get("channel_name_raw", ""),
        option.get("order_channel", ""),
        option.get("service_country", ""),
        raw.get("工作簿", "") if isinstance(raw, dict) else "",
        raw.get("工作表", "") if isinstance(raw, dict) else "",
        raw.get("来源sheet", "") if isinstance(raw, dict) else "",
        raw.get("来源报价表", "") if isinstance(raw, dict) else "",
        raw.get("渠道摘要", "") if isinstance(raw, dict) else "",
        raw.get("下单渠道", "") if isinstance(raw, dict) else "",
        raw.get("子渠道", "") if isinstance(raw, dict) else "",
        raw.get("服务国家", "") if isinstance(raw, dict) else "",
        raw.get("国家或分区", "") if isinstance(raw, dict) else "",
        *raw_values,
    ]
    return normalize_text(" ".join(str(v) for v in values if v not in [None, ""]))


def shipping_matches_option(option: Dict[str, Any], requested: str) -> bool:
    strong = normalize_text(option.get("shipping_method")).lower()
    text = remote_option_text(option).lower()
    requested = normalize_text(requested)
    source = strong or text
    if requested == "空运":
        return any(token in source for token in ["空运", "空派", "空卡", "air"]) and not any(token in source for token in ["海运", "铁路", "卡航"])
    if requested == "海运":
        return any(token in source for token in ["海运", "海派", "海卡", "慢船", "整柜", "ocean", "sea"]) and not any(token in source for token in ["空运", "空派", "铁路", "卡航"])
    if requested == "铁路":
        return any(token in source for token in ["铁路", "欧铁", "rail"]) and not any(token in source for token in ["海运", "空运", "空派", "卡航"])
    if requested == "卡航":
        return any(token in source for token in ["卡航", "卡车航"]) and not any(token in source for token in ["海运", "铁路", "空运", "空派"])
    return requested in source


def tax_matches_option(option: Dict[str, Any], requested: str) -> bool:
    requested = normalize_text(requested)
    value = normalize_text(option.get("tax_type"))
    text = remote_option_text(option)
    source_text = option_source_text(option)
    negative_terms = ["不包税", "自税", "递延", "不含税"]
    if requested == "包税":
        if any(term in source_text for term in negative_terms):
            return False
        if value:
            return value == "包税" or ("包税" in value and not any(term in value for term in negative_terms))
        return "包税" in text and not any(term in text for term in negative_terms)
    if requested in ["不包税", "自税"]:
        if any(term in source_text for term in ["不包税", "自税", "递延", "不含税"]):
            return True
        if "包税" in source_text and not any(term in source_text for term in negative_terms):
            return False
        if value:
            return any(term in value for term in ["不包税", "自税", "递延", "不含税"])
        return any(term in text for term in ["不包税", "自税", "递延", "不含税"])
    if requested == "按方包税":
        return "按方包税" in (value or text)
    return option_text_field_matches(option, "tax_type", requested)


def delivery_matches_option(option: Dict[str, Any], requested: str) -> bool:
    requested = normalize_text(requested)
    if not requested:
        return True
    value = normalize_text(option.get("delivery_method"))
    text = remote_option_text(option)
    if requested == "卡派":
        if value:
            return "卡派" in value or "卡车派送" in value
        return any(term in text for term in ["卡派", "卡车派送"])
    if requested == "快递派":
        if value:
            return "快递" in value
        return "快递" in text
    if requested == "直送":
        if value:
            return "直送" in value
        return "直送" in text
    return requested in (value or text)


def option_text_field_matches(option: Dict[str, Any], field: str, requested: Any) -> bool:
    value = normalize_text(option.get(field))
    if not value:
        return True
    return norm_for_match(requested) in norm_for_match(value) or norm_for_match(value) in norm_for_match(requested)


def warehouse_matches_option(option: Dict[str, Any], requested_code: str, region: str) -> bool:
    code = normalize_text(requested_code).upper()
    if not code:
        return True
    if region == "EUROPE":
        values = [
            option.get("warehouse_code", ""),
            option.get("service_country", ""),
            option.get("destination", ""),
            option.get("country", ""),
            option.get("route_area", ""),
        ]
        raw = option.get("raw") or {}
        values.extend(
            raw.get(key, "")
            for key in ["国家或分区", "服务国家", "服务国家/地区", "服务区域", "目的地", "仓库", "仓库代码", "FBA仓点"]
        )
        return code in normalize_text(" ".join(str(v) for v in values if v is not None)).upper()
    text = remote_option_text(option).upper()
    return code in text


def filter_remote_options_by_explicit_fields(options: List[Dict[str, Any]], fields: Dict[str, Any], report: LoadReport) -> List[Dict[str, Any]]:
    out = list(options)
    region = fields.get("quote_region") or detect_quote_region(fields)
    if fields.get("warehouse_code"):
        before = len(out)
        out = [opt for opt in out if warehouse_matches_option(opt, fields["warehouse_code"], region)]
        report.filtering_steps.append((f"远程结果仓库代码筛选：{fields['warehouse_code']}", len(out)))
        if before and not out:
            report.zero_filter = "仓库代码"
            report.no_match_type = "filters_too_strict"
            report.no_match_reason = "已找到相关仓库/目的地记录，但当前筛选条件过严，导致没有可用报价。"
            return out
    filters = [
        ("shipping_method", "运输方式"),
        ("tax_type", "税务类型"),
        ("origin_warehouse", "起运仓"),
        ("billing_method", "计费方式"),
        ("delivery_method", "派送方式"),
    ]
    for field, label in filters:
        if not fields.get(field):
            continue
        before = len(out)
        if field == "shipping_method":
            out = [opt for opt in out if shipping_matches_option(opt, fields[field])]
        elif field == "tax_type":
            out = [opt for opt in out if tax_matches_option(opt, fields[field])]
        elif field == "delivery_method":
            out = [opt for opt in out if delivery_matches_option(opt, fields[field])]
        else:
            out = [opt for opt in out if option_text_field_matches(opt, field, fields[field])]
        report.filtering_steps.append((f"远程结果{label}筛选：{fields[field]}", len(out)))
        if before and not out:
            report.zero_filter = label
            report.no_match_type = "filters_too_strict"
            report.no_match_reason = "已找到相关仓库/目的地记录，但当前筛选条件过严，导致没有可用报价。"
            return out

    excluded = fields.get("_exclude_shipping_method")
    if excluded:
        before = len(out)
        out = [opt for opt in out if not shipping_matches_option(opt, excluded)]
        report.filtering_steps.append((f"远程结果排除运输方式：{excluded}", len(out)))
        if before and not out:
            report.zero_filter = "运输方式"
            report.no_match_type = "filters_too_strict"
            report.no_match_reason = "已找到相关仓库/目的地记录，但当前筛选条件过严，导致没有可用报价。"
    return out


def classify_remote_no_match(fields: Dict[str, Any], report: LoadReport, config: Dict[str, Any]) -> None:
    if bool(fields.get("country") or fields.get("route_area")) and not has_specific_destination(fields):
        report.no_match_type = "missing_destination"
        report.no_match_reason = "当前询价只提供了国家/区域，但缺少仓库代码、目的仓、目的地城市或邮编。"
        return
    warehouse_code = normalize_text(fields.get("warehouse_code")).upper()
    hints = (config.get("remote_api", {}) or {}).get("warehouse_zip_hints", {}) or {}
    strict_filters = any(fields.get(k) for k in ["shipping_method", "billing_method", "tax_type"])
    if warehouse_code and warehouse_code in hints and strict_filters:
        report.no_match_type = "filters_too_strict"
        report.no_match_reason = "已找到相关仓库/目的地记录，但当前筛选条件过严，导致没有可用报价。"
    else:
        report.no_match_type = "no_data"
        report.no_match_reason = "已提供仓库代码/目的地信息，但成本表中未找到对应报价记录。"


def search_remote_cost_options(config: Dict[str, Any], fields: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], int, bool, LoadReport]:
    report = LoadReport()
    if bool(fields.get("country") or fields.get("route_area")) and not has_specific_destination(fields):
        report.loaded_files.append({"file": "remote REST API", "endpoint": "skipped - missing destination", "rows": 0})
        classify_remote_no_match(fields, report, config)
        return [], 0, False, report

    try:
        from remote_quote_client import call_rest_quote
    except Exception as exc:
        report.remote_error = f"无法加载远程报价客户端：{exc}"
        report.remote_error_type = "client_import_error"
        return [], 0, False, report

    result = call_rest_quote(fields, config)
    report.remote_url = result.get("url", "")
    report.remote_payload = result.get("payload", {}) or {}
    report.loaded_files.append({"file": "remote REST API", "endpoint": report.remote_url, "rows": len(result.get("options", []))})

    if not result.get("ok"):
        report.remote_error = result.get("error", "远程接口请求失败")
        report.remote_error_type = result.get("error_type", "backend_unavailable")
        return [], 0, False, report

    options = result.get("options", []) or []
    for option in options:
        if not option.get("origin_warehouse") and fields.get("origin_warehouse") and fields.get("_origin_warehouse_explicit"):
            option["origin_warehouse"] = fields.get("origin_warehouse")
        if fields.get("quote_region"):
            option["requested_quote_region"] = fields.get("quote_region")
        if not option.get("warehouse_code") and fields.get("warehouse_code"):
            option["warehouse_code"] = fields.get("warehouse_code")
        if not option.get("country") and fields.get("country"):
            option["country"] = fields.get("country")
        if not option.get("route_area") and fields.get("route_area"):
            option["route_area"] = fields.get("route_area")
        if fields.get("country"):
            option["requested_country"] = fields.get("country")
        if fields.get("route_area"):
            option["requested_route_area"] = fields.get("route_area")
        if not option.get("delivery_method") and fields.get("delivery_method"):
            option["delivery_method"] = fields.get("delivery_method")
        if option.get("weight_kg") is None and fields.get("weight_kg") is not None:
            option["weight_kg"] = fields.get("weight_kg")
        if not option.get("weight_display") and fields.get("weight_display"):
            option["weight_display"] = fields.get("weight_display")
        if not option.get("weight_condition") and fields.get("weight_condition"):
            option["weight_condition"] = fields.get("weight_condition")
        if option.get("volume_cbm") is None and fields.get("volume_cbm") is not None:
            option["volume_cbm"] = fields.get("volume_cbm")
        if option.get("piece_count") is None and fields.get("piece_count") is not None:
            option["piece_count"] = fields.get("piece_count")

    if options:
        options = filter_remote_options_by_explicit_fields(options, fields, report)

    if not options and not report.no_match_type:
        classify_remote_no_match(fields, report, config)

    sorted_options, total, limited = sort_and_label_option_list(options, fields, int(config.get("max_display_options", 20)))
    return sorted_options, total, limited, report


def search_cost_options(config: Dict[str, Any], fields: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], int, bool, LoadReport]:
    return search_remote_cost_options(config, fields)


def missing_info(fields: Dict[str, Any], options_found: bool = True, report: Optional[LoadReport] = None) -> List[str]:
    missing = []
    if report and report.no_match_type == "missing_destination":
        if not fields.get("warehouse_code"):
            missing.append("仓库代码 / FBA仓库代码")
        if not any(fields.get(k) for k in ["warehouse_name", "destination_port", "zipcode", "state"]):
            missing.append("目的仓 / 目的地城市 / 邮编")
        if not fields.get("shipping_method"):
            missing.append("运输方式")
        return missing
    if not fields.get("warehouse_code") and not fields.get("country") and not fields.get("route_area"):
        missing.append("国家/区域或仓库代码")
    if not fields.get("origin_warehouse"):
        missing.append("起运仓")
    if not fields.get("tax_type"):
        missing.append("税务类型")
    if not fields.get("shipping_method"):
        missing.append("运输方式")
    if not fields.get("weight_kg") and not fields.get("volume_cbm"):
        missing.append("重量或体积")
    if not options_found:
        missing.append("当前条件未匹配到成本方案，请补充或修正筛选条件")
    return missing


def create_task(
    sessions: Dict[str, Any],
    message: str,
    fields: Dict[str, Any],
    batch_items: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    batch_items = batch_items or []
    task = {
        "task_id": next_task_id(sessions),
        "status": STATUSES["IN_PROGRESS"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "customer_original_message": message,
        "extracted_fields": fields,
        "is_batch": len(batch_items) >= 2,
        "batch_items": batch_items if len(batch_items) >= 2 else [],
        "batch_results": [],
        "matched_cost_options": [],
        "selected_options": [],
        "margin_rules": {},
        "final_quote_result": {},
        "change_log": [],
    }
    add_change(task, "创建任务", {"message": message, "extracted_fields": fields})
    sessions.setdefault("tasks", []).append(task)
    sessions["active_task_id"] = task["task_id"]
    return task


def option_cards(options: List[Dict[str, Any]], limit: int) -> str:
    lines: List[str] = []
    for opt in options[:limit]:
        label = label_text(opt.get("labels") or [])
        header = f"方案 {opt.get('option_no')}"
        if label:
            header += f"｜{label}"
        lines.extend([header, *option_detail_lines(opt), ""])
    return "\n".join(lines).rstrip() if lines else "-"


def no_match_block(report: LoadReport) -> str:
    if report.no_match_type == "missing_destination":
        return """未找到匹配成本方案。
当前询价缺少仓库代码/目的仓信息，无法确认准确成本价。

【未匹配原因】
当前询价只提供了国家/区域，但缺少仓库代码、目的仓、目的地城市或邮编。该类报价需要具体仓库/目的地才能确认成本价。

【请客服补充】
1. 仓库代码 / FBA仓库代码
2. 目的仓 / 目的地城市 / 邮编
3. 是否FBA
4. 运输方式：海运 / 空运 / 铁路 / 卡航
5. 税务类型：包税 / 不包税 / 按方包税"""
    if report.no_match_type == "no_data":
        return """未找到匹配成本方案。

【未匹配原因】
已提供仓库代码/目的地信息，但成本表中未找到对应报价记录，可能该仓库暂未收录或当前报价版本没有该线路。

【建议处理】
1. 请核对仓库代码是否正确。
2. 请确认是否为当前报价版本已收录线路。
3. 如确认信息无误，请联系负责人确认是否有最新报价。"""
    if report.no_match_type == "filters_too_strict":
        return """未找到匹配成本方案。

【未匹配原因】
已找到相关仓库/目的地记录，但当前筛选条件过严，导致没有可用报价。

【可能过严的条件】
- 运输方式
- 税务类型
- 起运仓
- 计费方式
- 重量/体积区间

【建议处理】
请客服确认是否可以放宽运输方式、税务类型或起运仓后重新查询。"""
    return "未找到匹配成本方案。"


def compact_no_match_reason(report: Any) -> str:
    if isinstance(report, dict):
        remote_error = report.get("remote_error", "")
        no_match_type = report.get("no_match_type", "")
    else:
        remote_error = getattr(report, "remote_error", "")
        no_match_type = getattr(report, "no_match_type", "")
    if remote_error:
        return REMOTE_FAIL_CLOSED_MESSAGE
    if no_match_type == "missing_destination":
        return "缺少仓库代码、目的仓、目的地城市或邮编，无法确认准确成本价。"
    if no_match_type == "filters_too_strict":
        return "已找到相关仓库/目的地记录，但当前筛选条件过严。"
    if no_match_type == "no_data":
        return "已提供仓库代码/目的地信息，但成本表中未找到对应报价记录。"
    return "当前条件下未找到可用报价。"


def option_identity(option: Dict[str, Any]) -> Tuple[Any, ...]:
    return (
        option.get("option_no"),
        option.get("channel_name"),
        option.get("cost_price"),
        option.get("reference_eta"),
        option.get("data_source"),
        option.get("source_row"),
    )


def select_batch_summary_options(options: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not options:
        return []

    valid_cost = [o for o in options if o.get("cost_price") is not None]
    best = min(valid_cost, key=lambda o: (float(o.get("cost_price")), o.get("eta_days") if o.get("eta_days") is not None else float("inf"))) if valid_cost else options[0]

    valid_eta = [o for o in options if o.get("eta_days") is not None]
    fastest = min(valid_eta, key=lambda o: (float(o.get("eta_days")), o.get("cost_price") if o.get("cost_price") is not None else float("inf"))) if valid_eta else None

    selected: List[Dict[str, Any]] = []
    for candidate, label in [(best, "Best Cost"), (fastest, "Fastest ETA")]:
        if not candidate:
            continue
        existing = next((opt for opt in selected if option_identity(opt) == option_identity(candidate)), None)
        if existing:
            if label not in existing["labels"]:
                existing["labels"].append(label)
            continue
        item = deepcopy(candidate)
        item["labels"] = [label]
        selected.append(item)

    for idx, option in enumerate(selected, 1):
        option["batch_option_no"] = idx
    return selected


def batch_option_cards(result: Dict[str, Any]) -> str:
    item = result.get("item", {})
    weight_text = item.get("weight_display") or f"{format_money(item.get('weight_kg'))}KG"
    lines = [f"{item.get('warehouse_code')}｜{weight_text}"]
    selected = result.get("selected_options", [])
    if not selected:
        lines.extend(
            [
                "未找到匹配成本方案。",
                f"原因：{compact_no_match_reason(result.get('report', LoadReport()))}",
                "",
            ]
        )
        return "\n".join(lines).rstrip()

    for opt in selected:
        label = label_text(opt.get("labels") or [])
        header = f"方案 {opt.get('batch_option_no', opt.get('option_no'))}"
        if label:
            header += f"｜{label}"
        lines.extend([header, *option_detail_lines(opt), ""])
    if not any("Fastest ETA" in opt.get("labels", []) for opt in selected):
        lines.append("该仓库当前接口未返回可比较时效，暂不标注时效最快方案。")
    return "\n".join(lines).rstrip()


def batch_recognition_block(task: Dict[str, Any]) -> str:
    items = task.get("batch_items", [])
    lines = [f"共识别到 {len(items)} 个仓库："]
    for idx, item in enumerate(items, 1):
        weight_text = item.get("weight_display") or f"{format_money(item.get('weight_kg'))}KG"
        lines.append(f"{idx}. {item.get('warehouse_code')} - {weight_text}")
    return "\n".join(lines)


def batch_stage1_output(
    task: Dict[str, Any],
    action: str,
    config: Dict[str, Any],
    results_override: Optional[List[Dict[str, Any]]] = None,
) -> str:
    results = results_override if results_override is not None else task.get("batch_results", [])
    total_candidates = sum(int(r.get("total", 0)) for r in results)
    displayed_count = sum(len(r.get("selected_options", [])) for r in results)
    no_result_count = sum(1 for r in results if not r.get("selected_options"))
    result_cards = "\n\n".join(batch_option_cards(r) for r in results) if results else "-"
    if displayed_count:
        next_step = """请客服输入毛利率，例如：
- 统一按 15%

批量任务会对每个仓库当前展示的性价比最高/时效最快方案统一计算报价。"""
    else:
        next_step = "请客服补充或修正仓库、重量、起运仓、税务类型、运输方式等信息后重新查询。"

    summary_line = f"共查询到 {total_candidates} 个候选方案，当前展示 {displayed_count} 个代表方案。"
    if no_result_count:
        summary_line += f" 其中 {no_result_count} 个仓库暂未匹配到方案。"
    strategy = task.get("batch_query_strategy", "")
    if strategy == "same_weight_combined_batch":
        strategy_note = "- 本批次各仓库重量相同，使用一次远程数据库批量查询，并按接口返回的“按FBA仓报价”分仓展示。"
    elif batch_weights_are_identical(task.get("batch_items", [])):
        strategy_note = "- 本批次各仓库重量相同，生产默认仍按仓库分别查询远程数据库，避免批量接口按首仓或合并结果误判。"
    else:
        strategy_note = "- 本批次各仓库重量不同，已按仓库分别查询远程数据库，确保每个仓库使用自己的实际重量段。"

    output = f"""【当前报价任务】
任务编号：{task.get('task_id')}
状态：{display_status(task.get('status'))}
本次动作：{action}

【批量询价识别】
{batch_recognition_block(task)}

【批量成本方案】
{summary_line}

{result_cards}

【方案说明】
{strategy_note}
- 批量询价每个仓库仅展示性价比最高和时效最快方案。
- 如同一方案同时满足两个条件，只展示一次并同时标记。
- 渠道显示产品/仓库相关名称，运输方式单独显示，不合并为泛化运输标签。

【需要客服人工确认】
1. 偏远费未包含
2. 附加费未包含
3. 保险未包含
4. 货拉拉/提货费用未包含
5. 特殊货物需人工确认是否可接

【下一步】
{next_step}

{command_help()}"""
    debug = ""
    if config.get("debug"):
        debug_lines = ["", "【Debug】", f"- batch_items: {json.dumps(task.get('batch_items', []), ensure_ascii=False)}"]
        for result in results:
            report = result.get("report")
            if report:
                debug_lines.append(
                    f"- {result.get('item', {}).get('warehouse_code')}: total={result.get('total')} no_match_type={getattr(report, 'no_match_type', '')} remote_error={getattr(report, 'remote_error', '')}"
                )
        debug = "\n".join(debug_lines)
    return output + debug


def debug_block(config: Dict[str, Any], fields: Dict[str, Any], report: Optional[LoadReport]) -> str:
    if not config.get("debug"):
        return ""
    lines = ["", "【Debug】", f"- extracted_fields: {json.dumps(fields, ensure_ascii=False)}"]
    if report:
        lines.append(f"- loaded_files: {json.dumps(report.loaded_files, ensure_ascii=False)}")
        lines.append("- filtering_steps:")
        for step, count in report.filtering_steps:
            lines.append(f"  - {step}: {count}")
        if report.zero_filter:
            lines.append(f"- zero_filter: {report.zero_filter}")
        if report.no_match_type:
            lines.append(f"- no_match_type: {report.no_match_type}")
        if report.remote_url:
            lines.append(f"- remote_url: {report.remote_url}")
        if report.remote_payload:
            lines.append(f"- remote_payload: {json.dumps(report.remote_payload, ensure_ascii=False)}")
        if report.remote_error:
            lines.append(f"- remote_error_type: {report.remote_error_type}")
            lines.append(f"- remote_error: {report.remote_error}")
        if report.warnings:
            lines.append("- warnings:")
            for warning in report.warnings:
                lines.append(f"  - {warning}")
        if report.detected_columns:
            lines.append("- detected_columns:")
            for file_name, columns in report.detected_columns.items():
                lines.append(f"  - {file_name}: {', '.join(columns)}")
    return "\n".join(lines)


def data_warning_block(report: Optional[LoadReport]) -> str:
    if not report or not report.warnings:
        return ""
    lines = ["", "【数据读取提示】"]
    for warning in report.warnings:
        lines.append(f"- {warning}")
    return "\n".join(lines)


def remote_error_block(report: LoadReport) -> str:
    lines = [
        REMOTE_FAIL_CLOSED_MESSAGE,
    ]
    if report.remote_error:
        lines.extend(["", "【接口错误】", report.remote_error])
    return "\n".join(lines)


def stage1_output(
    task: Dict[str, Any],
    action: str,
    total: int,
    limited: bool,
    report: LoadReport,
    config: Dict[str, Any],
) -> str:
    fields = task.get("extracted_fields", {})
    options = task.get("matched_cost_options", [])
    display_limit = len(options) if options else int(config.get("max_options_display_stage1", 10))
    missing = missing_info(fields, bool(options), report)
    missing_text = "\n".join(f"- {item}" for item in missing) if missing else "-"
    found_line = f"共匹配到 {total} 个方案。"
    if options and len(options) > display_limit:
        found_line = (
            f"共匹配到 {total} 个方案，当前仅展示前 {display_limit} 个。"
            "可补充仓库、运输方式、税务类型等条件继续筛选。"
        )

    if options:
        cards = option_cards(options, display_limit)
    elif report.remote_error:
        cards = remote_error_block(report)
    else:
        cards = no_match_block(report)
    if options:
        next_step = """请客服输入毛利率，例如：
- 统一按 15%
- 方案 1 按 12%，方案 2 按 18%
- 只计算方案 1 和方案 3，毛利率 15%

已保存全部匹配方案，可输入 /当前任务 查看摘要，或补充条件继续筛选。"""
    else:
        next_step = "请客服补充或修正仓库、国家/区域、起运仓、税务类型、运输方式、重量/体积等信息后重新查询。"
    display_action = action
    if not options and report.no_match_type == "missing_destination":
        display_action = "创建询价任务，但因缺少关键目的仓信息，未能查询成本"
    output = f"""【当前报价任务】
任务编号：{task.get('task_id')}
状态：{display_status(task.get('status'))}
本次动作：{display_action}

【询价信息识别】
客户原文：{task.get('customer_original_message', '')}
已识别信息：
- 国家/区域：{fields.get('country') or fields.get('route_area') or ''}
- 仓库代码：{', '.join(fields.get('warehouse_codes', [])) if fields.get('warehouse_codes') else fields.get('warehouse_code', '')}
- 起运仓：{fields.get('origin_warehouse', '')}
- 重量：{fields.get('weight_display') or (format_money(fields.get('weight_kg')) + ' KG' if fields.get('weight_kg') is not None else '')}
- 体积：{format_money(fields.get('volume_cbm')) + ' CBM' if fields.get('volume_cbm') is not None else ''}
- 件数：{fields.get('piece_count', '')}
- 税务类型：{fields.get('tax_type', '')}
- 运输方式：{fields.get('shipping_method', '')}
- 派送方式：{fields.get('delivery_method', '')}
- 时效偏好：{fields.get('time_preference', '')}

【缺失信息】
{missing_text}

【匹配成本方案】
{found_line}

{cards}

【方案说明】
- 性价比最高：当前匹配条件下成本价最低。
- 时效最快：当前匹配条件下参考时效最快。
- 如果匹配结果过多，请客服补充仓库、起运仓、税务类型、重量/体积等信息。

【需要客服人工确认】
1. 偏远费未包含
2. 附加费未包含
3. 保险未包含
4. 货拉拉/提货费用未包含
5. 特殊货物需人工确认是否可接

【下一步】
{next_step}

{command_help()}"""
    return output + data_warning_block(report) + debug_block(config, fields, report)


def report_to_summary(report: LoadReport) -> Dict[str, Any]:
    return {
        "loaded_files": report.loaded_files,
        "warnings": report.warnings,
        "filtering_steps": report.filtering_steps,
        "zero_filter": report.zero_filter,
        "no_match_type": report.no_match_type,
        "no_match_reason": report.no_match_reason,
        "remote_error": report.remote_error,
        "remote_error_type": report.remote_error_type,
        "remote_url": report.remote_url,
        "remote_payload": report.remote_payload,
    }


def clone_remote_report(base: LoadReport) -> LoadReport:
    report = LoadReport()
    report.loaded_files = deepcopy(base.loaded_files)
    report.warnings = deepcopy(base.warnings)
    report.remote_url = base.remote_url
    report.remote_payload = deepcopy(base.remote_payload)
    report.remote_error = base.remote_error
    report.remote_error_type = base.remote_error_type
    report.no_match_type = base.no_match_type
    report.no_match_reason = base.no_match_reason
    return report


def batch_weights_are_identical(batch_items: List[Dict[str, Any]]) -> bool:
    weights = [to_float(item.get("weight_kg")) for item in batch_items]
    if len(weights) < 2 or any(weight is None for weight in weights):
        return False
    first = weights[0]
    return all(weight == first for weight in weights)


def run_batch_stage1(config: Dict[str, Any], sessions: Dict[str, Any], task: Dict[str, Any], action: str) -> str:
    base_fields = task.get("extracted_fields", {})
    output_results: List[Dict[str, Any]] = []
    stored_results: List[Dict[str, Any]] = []
    flattened_selected: List[Dict[str, Any]] = []

    batch_items = task.get("batch_items", [])
    # Production defaults to per-warehouse remote calls for price-tier accuracy.
    # Same-weight combined lookup remains opt-in for deployments that enable it.
    use_combined_batch = batch_weights_are_identical(batch_items) and bool(config.get("allow_same_weight_remote_batch", False))
    query_strategy = "same_weight_combined_batch" if use_combined_batch else "per_warehouse_actual_weight"
    batch_report = LoadReport()
    remote_batch: List[Dict[str, Any]] = []
    raw_remote_response: Dict[str, Any] = {}
    remote_payloads: List[Dict[str, Any]] = []

    if use_combined_batch:
        try:
            from remote_quote_client import call_rest_quote
            batch_fields = deepcopy(base_fields)
            batch_fields["_batch_warehouse_codes"] = [item.get("warehouse_code") for item in batch_items if item.get("warehouse_code")]
            batch_fields["_batch_query_weight_kg"] = to_float(batch_items[0].get("weight_kg"))
            result = call_rest_quote(batch_fields, config)
            batch_report.remote_url = result.get("url", "")
            batch_report.remote_payload = result.get("payload", {}) or {}
            raw_remote_response = result.get("response_json", {}) or {}
            remote_batch = result.get("batch_results", []) or []
            batch_report.loaded_files.append({"file": "remote REST API", "endpoint": batch_report.remote_url, "rows": sum(len(r.get("options", [])) for r in remote_batch)})
            if not result.get("ok"):
                batch_report.remote_error = result.get("error", "远程接口请求失败")
                batch_report.remote_error_type = result.get("error_type", "backend_unavailable")
            elif not remote_batch:
                batch_report.remote_error = "远程接口未返回按FBA仓报价，无法按仓库生成准确报价。"
                batch_report.remote_error_type = "invalid_response"
        except Exception as exc:
            batch_report.remote_error = f"远程批量报价请求失败：{exc}"
            batch_report.remote_error_type = "backend_unavailable"

    by_code = {
        normalize_text(item.get("warehouse_code")).upper(): item
        for item in remote_batch
        if normalize_text(item.get("warehouse_code"))
    }

    for idx, item in enumerate(batch_items, 1):
        item_fields = deepcopy(base_fields)
        item_fields.update(item)
        report = clone_remote_report(batch_report)
        code = normalize_text(item.get("warehouse_code")).upper()
        if use_combined_batch:
            remote_item = by_code.get(code)
            options = deepcopy(remote_item.get("options", [])) if remote_item else []
            if not remote_item and not report.remote_error:
                report.no_match_type = "no_data"
                report.no_match_reason = "已提供仓库代码/目的地信息，但报价数据库中未找到对应报价记录。"
        else:
            options, total, limited, report = search_cost_options(config, item_fields)
            if report.remote_payload:
                remote_payloads.append({"warehouse_code": item.get("warehouse_code"), "payload": deepcopy(report.remote_payload)})

        if use_combined_batch:
            for option in options:
                option["warehouse_code"] = item.get("warehouse_code")
                if not option.get("origin_warehouse") and item_fields.get("origin_warehouse") and item_fields.get("_origin_warehouse_explicit"):
                    option["origin_warehouse"] = item_fields.get("origin_warehouse")
                if not option.get("weight_display") and item_fields.get("weight_display"):
                    option["weight_display"] = item_fields.get("weight_display")
                if option.get("weight_kg") is None and item_fields.get("weight_kg") is not None:
                    option["weight_kg"] = item_fields.get("weight_kg")

            if options:
                options = filter_remote_options_by_explicit_fields(options, item_fields, report)
            if not options and not report.no_match_type and not report.remote_error:
                classify_remote_no_match(item_fields, report, config)

            options, total, limited = sort_and_label_option_list(options, item_fields, int(config.get("max_display_options", 20)))

        selected = select_batch_summary_options(options)
        for selected_option in selected:
            selected_option["batch_item_no"] = idx
            selected_option["batch_warehouse_code"] = item.get("warehouse_code")
            selected_option["batch_weight_kg"] = item.get("weight_kg")
            selected_option["batch_weight_display"] = item.get("weight_display")
            selected_option["weight_display"] = item.get("weight_display")
            selected_option["weight_condition"] = item.get("weight_condition")
            selected_option["batch_total_candidates"] = total
            selected_option["option_no"] = len(flattened_selected) + 1
            flattened_selected.append(selected_option)

        output_result = {
            "item": item,
            "fields": item_fields,
            "matched_cost_options": options,
            "selected_options": selected,
            "total": total,
            "limited": limited,
            "report": report,
        }
        output_results.append(output_result)
        stored_results.append(
            {
                "item": item,
                "fields": item_fields,
                "matched_cost_options": options,
                "selected_options": selected,
                "total": total,
                "limited": limited,
                "report": report_to_summary(report),
            }
        )

    task["batch_results"] = stored_results
    if raw_remote_response:
        task["raw_remote_batch_response"] = raw_remote_response
    task["remote_batch_payload"] = batch_report.remote_payload
    task["remote_batch_payloads"] = remote_payloads
    task["batch_query_strategy"] = query_strategy
    task["matched_cost_options"] = flattened_selected
    task["selected_options"] = []
    task["margin_rules"] = {}
    task["final_quote_result"] = {}
    task["status"] = STATUSES["WAITING_MARGIN"] if flattened_selected else STATUSES["WAITING_INFO"]
    add_change(
        task,
        "批量成本查询",
        {
            "batch_count": len(task.get("batch_items", [])),
            "displayed_count": len(flattened_selected),
            "candidate_count": sum(int(r.get("total", 0)) for r in stored_results),
            "no_result_count": sum(1 for r in stored_results if not r.get("selected_options")),
            "query_strategy": query_strategy,
        },
    )
    save_sessions(config, sessions)
    return batch_stage1_output(task, action, config, output_results)


def run_stage1(config: Dict[str, Any], sessions: Dict[str, Any], task: Dict[str, Any], action: str) -> str:
    if task.get("is_batch"):
        return run_batch_stage1(config, sessions, task, action)
    options, total, limited, report = search_cost_options(config, task.get("extracted_fields", {}))
    task["matched_cost_options"] = options
    task["selected_options"] = []
    task["margin_rules"] = {}
    task["final_quote_result"] = {}
    task["status"] = STATUSES["WAITING_MARGIN"] if options else STATUSES["WAITING_INFO"]
    add_change(
        task,
        "成本查询",
        {
            "matched_count": total,
            "displayed_count": min(len(options), int(config.get("max_options_display_stage1", 10))),
            "saved_count": len(options),
            "no_match_type": report.no_match_type,
        },
    )
    save_sessions(config, sessions)
    return stage1_output(task, action, total, limited, report, config)


def parse_margin_rules(message: str, option_count: int) -> Dict[str, Any]:
    text = normalize_text(message)
    rules: Dict[str, Any] = {"raw_message": message, "default_margin": None, "option_margins": {}, "selected_options": []}

    if re.search(r"(?:只计算|仅计算|onlycalculate|only)", text, re.IGNORECASE):
        nums = [int(n) for n in re.findall(r"(?:方案|option)\s*(\d+)", text, re.IGNORECASE)]
        if not nums:
            before_margin = re.split(r"(?:毛利|利润|margin|\d+(?:\.\d+)?\s*%)", text, maxsplit=1, flags=re.IGNORECASE)[0]
            nums = [int(n) for n in re.findall(r"\d+", before_margin)]
        rules["selected_options"] = [n for n in nums if 1 <= n <= option_count]

    for opt, pct in re.findall(r"(?:方案|option)\s*(\d+)[^\d%]{0,12}(\d+(?:\.\d+)?)\s*%", message, re.IGNORECASE):
        n = int(opt)
        if 1 <= n <= option_count:
            rules["option_margins"][str(n)] = float(pct) / 100.0

    all_pcts = [float(p) / 100.0 for p in re.findall(r"(\d+(?:\.\d+)?)\s*%", message)]
    if all_pcts:
        if not rules["option_margins"] or len(all_pcts) == 1:
            rules["default_margin"] = all_pcts[-1]

    if not rules["selected_options"]:
        if rules["option_margins"]:
            rules["selected_options"] = sorted(int(k) for k in rules["option_margins"].keys())
        else:
            rules["selected_options"] = list(range(1, option_count + 1))

    return rules


def margin_display(margin: float) -> str:
    return f"{margin * 100:.2f}%".rstrip("0").rstrip(".") + ("" if str(margin * 100).endswith(".0") else "")


def calculate_final(task: Dict[str, Any], rules: Dict[str, Any]) -> List[Dict[str, Any]]:
    fields = task.get("extracted_fields", {})
    options = task.get("matched_cost_options", [])
    results = []
    for option_no in rules.get("selected_options", []):
        if option_no < 1 or option_no > len(options):
            continue
        opt = deepcopy(options[option_no - 1])
        margin = rules.get("option_margins", {}).get(str(option_no), rules.get("default_margin"))
        if margin is None:
            continue
        cost = opt.get("cost_price")
        if cost is None:
            continue
        cost_decimal = to_decimal(cost)
        if cost_decimal is None:
            continue
        raw_final_unit = cost_decimal * (Decimal("1") + Decimal(str(margin)))
        final_unit = ceil_to_1_decimal(raw_final_unit)
        if final_unit is None:
            continue
        billing = normalize_text(opt.get("billing_method"))
        charge_qty = ""
        total = None
        missing = ""
        weight_kg = opt.get("batch_weight_kg", fields.get("weight_kg"))
        volume_cbm = opt.get("batch_volume_cbm", fields.get("volume_cbm"))
        if "kg" in billing.lower() or "公斤" in billing:
            if weight_kg is not None:
                charge_qty = f"{format_money(weight_kg)} KG"
                total = final_unit * Decimal(str(weight_kg))
            else:
                missing = "缺少重量，未计算预估总价"
        elif "cbm" in billing.lower() or "方" in billing:
            if volume_cbm is not None:
                charge_qty = f"{format_money(volume_cbm)} CBM"
                total = final_unit * Decimal(str(volume_cbm))
            else:
                missing = "缺少体积，未计算预估总价"
        else:
            missing = "计费方式不是按KG/CBM，未自动计算预估总价"
        results.append(
            {
                "option_no": option_no,
                "batch_item_no": opt.get("batch_item_no"),
                "batch_option_no": opt.get("batch_option_no"),
                "batch_warehouse_code": opt.get("batch_warehouse_code"),
                "batch_weight_kg": opt.get("batch_weight_kg"),
                "batch_weight_display": opt.get("batch_weight_display"),
                "weight_display": opt.get("weight_display"),
                "weight_condition": opt.get("weight_condition"),
                "batch_volume_cbm": opt.get("batch_volume_cbm"),
                "source_file": opt.get("source_file", opt.get("data_source", "")),
                "source_name": opt.get("source_name", opt.get("data_source", "")),
                "data_source": opt.get("data_source", ""),
                "worksheet": opt.get("worksheet", opt.get("source_sheet", "")),
                "source_sheet": opt.get("source_sheet", ""),
                "source_row": opt.get("source_row", ""),
                "rate_line_id": opt.get("rate_line_id", ""),
                "record_id": opt.get("record_id", ""),
                "warehouse_code": opt.get("warehouse_code", fields.get("warehouse_code", "")),
                "warehouse_name": opt.get("warehouse_name", fields.get("warehouse_name", "")),
                "zipcode": opt.get("zipcode", fields.get("zipcode", "")),
                "destination": opt.get("destination", fields.get("destination", "")),
                "route_area": opt.get("route_area", fields.get("route_area", "")),
                "country": opt.get("country", fields.get("country", "")),
                "requested_country": opt.get("requested_country", fields.get("country", "")),
                "requested_route_area": opt.get("requested_route_area", fields.get("route_area", "")),
                "requested_quote_region": opt.get("requested_quote_region", fields.get("quote_region", "")),
                "quote_region": opt.get("quote_region", fields.get("quote_region", "")),
                "product_name": opt.get("product_name", ""),
                "channel_product": opt.get("channel_product", ""),
                "order_channel": opt.get("order_channel", ""),
                "service_country": opt.get("service_country", ""),
                "channel_summary": opt.get("channel_summary", ""),
                "channel_name": opt.get("channel_name", ""),
                "channel_name_raw": opt.get("channel_name_raw", ""),
                "shipping_method": opt.get("shipping_method", ""),
                "delivery_method": opt.get("delivery_method", fields.get("delivery_method", "")),
                "origin_warehouse": opt.get("origin_warehouse", ""),
                "tax_type": opt.get("tax_type", ""),
                "billing_method": opt.get("billing_method", ""),
                "currency": opt.get("currency", "RMB"),
                "price_unit": opt.get("price_unit", ""),
                "cost_price": cost,
                "cost_price_display": format_money(cost),
                "margin": margin,
                "raw_final_unit_price": float(raw_final_unit),
                "final_unit_price": float(final_unit),
                "final_unit_price_display": format_1_decimal(final_unit),
                "charge_qty": charge_qty,
                "estimated_total": float(total) if total is not None else None,
                "estimated_total_display": format_1_decimal(total) if total is not None else missing,
                "reference_eta": opt.get("reference_eta", ""),
                "ship_schedule": opt.get("ship_schedule", ""),
                "weight_kg": weight_kg,
                "volume_cbm": volume_cbm,
                "piece_count": opt.get("piece_count", fields.get("piece_count")),
                "labels": opt.get("labels", []),
            }
        )
    return results


def margin_summary(results: List[Dict[str, Any]]) -> str:
    if not results:
        return ""
    margins = [r["margin"] for r in results]
    if all(abs(m - margins[0]) < 0.000001 for m in margins):
        return f"统一 {margins[0] * 100:g}%"
    return "；".join(f"方案 {r['option_no']}：{r['margin'] * 100:g}%" for r in results)


def final_quote_cards(results: List[Dict[str, Any]], limit: int) -> str:
    lines: List[str] = []
    for r in results[:limit]:
        label = label_text(r.get("labels") or [])
        header = f"方案 {r['option_no']}"
        if label:
            header += f"｜{label}"
        lines.extend([header, *option_detail_lines(r, include_quote=True), ""])
    if len(results) > limit:
        lines.append(f"以上为前 {limit} 个报价方案，已保存全部计算结果。")
    return "\n".join(lines).rstrip() if lines else "-"


def customer_message(results: List[Dict[str, Any]], max_customer_options: int) -> str:
    lines = ["您好，根据您目前提供的信息，给您整理了以下参考报价：", ""]
    if results:
        heading = customer_quote_heading(results[0])
        if heading:
            lines.append(heading)
            lines.append(f"共 {len(results)} 个方案，毛利率：{margin_summary(results)}")
            lines.append("")
    if len(results) > max_customer_options:
        lines.append(f"以下展示前 {max_customer_options} 个报价方案，如需更多方案可继续筛选。")
        lines.append("")
    for r in results[:max_customer_options]:
        label = customer_header_label(r.get("labels") or [])
        header = f"方案 {r['option_no']}"
        if label:
            header += f"｜{label}"
        quote = customer_quote_line(r["currency"], r["final_unit_price"], r.get("price_unit"), r.get("billing_method"))
        total = r["estimated_total_display"]
        if r.get("estimated_total") is not None:
            total = customer_total_line(r["currency"], r.get("estimated_total"))
        lines.extend(
            [
                header,
                f"渠道：{show_returned(display_channel_path(r))}",
                f"报价：{show(quote)}",
                f"预估总价：{show(total)}",
                f"参考时效：{eta_display(r.get('reference_eta'))}",
                f"船期：{ship_schedule_display(r.get('ship_schedule'))}",
                "",
            ]
        )
    best = next((r for r in results if "Best Cost" in r.get("labels", [])), None)
    fastest = next((r for r in results if "Fastest ETA" in r.get("labels", [])), None)
    if best and fastest:
        best_text = f"方案 {best.get('option_no')}"
        fast_text = f"方案 {fastest.get('option_no')}"
        lines.append(f"其中，{best_text} 性价比较高，{fast_text} 时效更快。")
        lines.append("")
    elif best:
        best_text = f"方案 {best.get('option_no')}"
        lines.append(f"其中，{best_text} 性价比较高。")
        lines.append("")
    elif fastest:
        fast_text = f"方案 {fastest.get('option_no')}"
        lines.append(f"其中，{fast_text} 时效更快。")
        lines.append("")
    lines.append("以上为参考报价，不含偏远费、附加费、保险费、提货费及特殊货物费用，最终价格以确认货物信息和地址后为准。")
    return "\n".join(lines)


def grouped_batch_results(results: List[Dict[str, Any]]) -> List[Tuple[str, List[Dict[str, Any]]]]:
    groups: List[Tuple[str, List[Dict[str, Any]]]] = []
    by_key: Dict[str, List[Dict[str, Any]]] = {}
    for result in results:
        code = result.get("batch_warehouse_code") or "未识别仓库"
        if code not in by_key:
            by_key[code] = []
            groups.append((code, by_key[code]))
        by_key[code].append(result)
    return groups


def final_quote_batch_cards(results: List[Dict[str, Any]], limit: int) -> str:
    lines: List[str] = []
    shown = 0
    for code, group in grouped_batch_results(results):
        if shown >= limit:
            break
        weight = next((r.get("batch_weight_kg") for r in group if r.get("batch_weight_kg") is not None), None)
        lines.append(f"{code}｜{format_money(weight)}KG" if weight is not None else code)
        for r in group:
            if shown >= limit:
                break
            shown += 1
            label = label_text(r.get("labels") or [])
            header = f"方案 {r.get('batch_option_no') or shown}"
            if label:
                header += f"｜{label}"
            lines.extend([header, *option_detail_lines(r, include_quote=True), ""])
    if len(results) > limit:
        lines.append(f"以上为前 {limit} 个报价方案，已保存全部计算结果。")
    return "\n".join(lines).rstrip() if lines else "-"


def customer_batch_message(results: List[Dict[str, Any]]) -> str:
    lines = ["您好，根据您目前提供的信息，给您按仓库整理了以下参考报价：", ""]
    for code, group in grouped_batch_results(results):
        weight = next((r.get("batch_weight_kg") for r in group if r.get("batch_weight_kg") is not None), None)
        lines.append(f"{code}｜{format_money(weight)}KG" if weight is not None else code)
        lines.append("")
        for r in group:
            label = customer_header_label(r.get("labels") or [])
            header = f"方案 {r.get('batch_option_no') or r.get('option_no')}"
            if label:
                header += f"｜{label}"
            quote = customer_quote_line(r["currency"], r["final_unit_price"], r.get("price_unit"), r.get("billing_method"))
            total = r["estimated_total_display"]
            if r.get("estimated_total") is not None:
                total = customer_total_line(r["currency"], r.get("estimated_total"))
            lines.extend(
                [
                    header,
                    f"渠道：{show_returned(display_channel_path(r))}",
                    f"报价：{show(quote)}",
                    f"预估总价：{show(total)}",
                    f"参考时效：{eta_display(r.get('reference_eta'))}",
                    f"船期：{ship_schedule_display(r.get('ship_schedule'))}",
                    "",
                ]
            )
    lines.append("以上为参考报价，不含偏远费、附加费、保险费、提货费及特殊货物费用，最终价格以确认货物信息和地址后为准。")
    return "\n".join(lines)


def stage2_output(task: Dict[str, Any], action: str, results: List[Dict[str, Any]], config: Dict[str, Any]) -> str:
    stage2_limit = int(config.get("max_options_display_stage2", 10))
    customer_limit = int(config.get("max_customer_options", 5))
    if task.get("is_batch"):
        output = f"""【当前报价任务】
任务编号：{task.get('task_id')}
状态：{display_status(task.get('status'))}
本次动作：{action}

【批量最终报价方案】
已采用毛利率：{margin_summary(results)}

{final_quote_batch_cards(results, stage2_limit) if results else '-'}

【仍需人工确认】
1. 偏远费未包含
2. 附加费未包含
3. 保险未包含
4. 货拉拉/提货费用未包含
5. 特殊货物需人工确认是否可接

【可发送给客户】
{customer_batch_message(results) if results else '暂无可生成的最终报价方案，请检查毛利率或方案序号。'}

{command_help()}"""
        return output + debug_block(config, task.get("extracted_fields", {}), None)

    output = f"""【当前报价任务】
任务编号：{task.get('task_id')}
状态：{display_status(task.get('status'))}
本次动作：{action}

【最终报价方案】
已采用毛利率：{margin_summary(results)}

{final_quote_cards(results, stage2_limit) if results else '-'}

【仍需人工确认】
1. 偏远费未包含
2. 附加费未包含
3. 保险未包含
4. 货拉拉/提货费用未包含
5. 特殊货物需人工确认是否可接

【可发送给客户】
{customer_message(results, customer_limit) if results else '暂无可生成的最终报价方案，请检查毛利率或方案序号。'}

{command_help()}"""
    return output + debug_block(config, task.get("extracted_fields", {}), None)


def run_stage2(config: Dict[str, Any], sessions: Dict[str, Any], task: Dict[str, Any], message: str) -> str:
    options = task.get("matched_cost_options", [])
    if not options:
        return "当前任务没有可计算的成本方案，请先补充信息并生成成本方案。"
    rules = parse_margin_rules(message, len(options))
    results = calculate_final(task, rules)
    if not results:
        return "未识别到有效毛利率或方案序号，请输入例如：统一按 15%，或 方案 1 按 12%。"
    task["selected_options"] = rules.get("selected_options", [])
    task["margin_rules"] = rules
    task["final_quote_result"] = results
    task["status"] = STATUSES["FINAL"]
    add_change(task, "最终报价计算", {"margin_rules": rules})
    save_sessions(config, sessions)
    return stage2_output(task, "计算最终报价", results, config)


def summarize_task(task: Dict[str, Any]) -> str:
    fields = task.get("extracted_fields", {})
    options = task.get("matched_cost_options", [])
    next_action = "请补充询价信息。"
    if task.get("status") == STATUSES["WAITING_MARGIN"]:
        next_action = "请输入毛利率，例如：统一按 15%。"
    elif task.get("status") == STATUSES["FINAL"]:
        next_action = "可继续调整毛利率，或使用 /结束任务 完成任务。"
    elif task.get("status") == STATUSES["COMPLETED"]:
        next_action = "任务已结束。"
    if task.get("is_batch"):
        batch_lines = [
            f"{idx}. {item.get('warehouse_code')} - {item.get('weight_display') or (format_money(item.get('weight_kg')) + 'KG')}"
            for idx, item in enumerate(task.get("batch_items", []), 1)
        ]
        no_result_count = sum(1 for r in task.get("batch_results", []) if not r.get("selected_options"))
        return f"""【当前任务】
任务编号：{task.get('task_id')}
状态：{display_status(task.get('status'))}
更新时间：{task.get('updated_at')}

【批量询价识别】
{chr(10).join(batch_lines) if batch_lines else '-'}

【已识别公共信息】
{json.dumps(fields, ensure_ascii=False, indent=2)}

【匹配方案摘要】
批量仓库数：{len(task.get('batch_items', []))}
已保存代表方案数：{len(options)}
未匹配仓库数：{no_result_count}

【下一步】
{next_action}

{command_help()}"""
    return f"""【当前任务】
任务编号：{task.get('task_id')}
状态：{display_status(task.get('status'))}
更新时间：{task.get('updated_at')}

【已识别信息】
{json.dumps(fields, ensure_ascii=False, indent=2)}

【匹配方案摘要】
已保存匹配方案数：{len(options)}
最低成本：{format_money(min([o.get('cost_price') for o in options if o.get('cost_price') is not None], default=''))}
最快时效：{next((eta_display(o.get('reference_eta')) for o in options if 'Fastest ETA' in o.get('labels', [])), '')}

【下一步】
{next_action}

{command_help()}"""


def task_list_output(sessions: Dict[str, Any]) -> str:
    tasks = sorted(sessions.get("tasks", []), key=lambda t: t.get("updated_at", ""), reverse=True)[:20]
    if not tasks:
        return "暂无报价任务。"
    lines = ["【任务列表】", ""]
    for task in tasks:
        summary = normalize_text(task.get("customer_original_message", ""))[:28]
        lines.extend(
            [
                f"任务编号：{task.get('task_id')}",
                f"询价摘要：{summary}",
                f"状态：{display_status(task.get('status'))}",
                f"更新时间：{task.get('updated_at')}",
                "",
            ]
        )
    lines.append(command_help())
    return "\n".join(lines)


def handle_command(config: Dict[str, Any], sessions: Dict[str, Any], message: str) -> Optional[str]:
    stripped = message.strip()
    if stripped.startswith("/重置任务"):
        reset_sessions_file(config)
        return "已清空所有报价任务记录。"

    if stripped.startswith("/检查报价接口"):
        try:
            from remote_quote_client import check_rest_health
            result = check_rest_health(config)
            status = "可用" if result.get("ok") else "不可用"
            lines = [
                "【报价接口检查】",
                f"REST 地址：{result.get('url', '')}",
                f"状态：{status}",
            ]
            if not result.get("ok") and result.get("error"):
                lines.append(f"错误信息：{result.get('error')}")
            return "\n".join(lines)
        except Exception as exc:
            return "\n".join([
                "【报价接口检查】",
                f"REST 地址：{(config.get('remote_api', {}) or {}).get('base_url', '')}{(config.get('remote_api', {}) or {}).get('health_endpoint', '/health')}",
                "状态：不可用",
                f"错误信息：{exc}",
            ])

    if stripped.startswith("/current-task") or stripped.startswith("/当前任务"):
        task = active_task(sessions)
        return summarize_task(task) if task else "当前没有活动报价任务。"

    if stripped.startswith("/task-list") or stripped.startswith("/任务列表"):
        return task_list_output(sessions)

    if stripped.startswith("/finish-task") or stripped.startswith("/结束任务"):
        task = active_task(sessions)
        if not task:
            return "当前没有活动报价任务。"
        task["status"] = STATUSES["COMPLETED"]
        add_change(task, "结束任务", {})
        save_sessions(config, sessions)
        return f"任务 {task.get('task_id')} 已标记为已结束。\n\n{command_help()}"

    switch_match = re.match(r"^/(?:switch-task|切换任务)\s+(Q-\d{8}-\d{3})", stripped, re.IGNORECASE)
    if switch_match:
        task_id = switch_match.group(1).upper()
        task = get_task(sessions, task_id)
        if not task:
            return f"未找到任务：{task_id}"
        sessions["active_task_id"] = task_id
        save_sessions(config, sessions)
        return "已切换任务。\n\n" + summarize_task(task)

    interrupt_prefixes = ["/interrupt-and-new", "/中断并新开"]
    for prefix in interrupt_prefixes:
        if stripped.startswith(prefix):
            current = active_task(sessions)
            if current and current.get("status") not in [STATUSES["COMPLETED"], STATUSES["INTERRUPTED"]]:
                current["status"] = STATUSES["INTERRUPTED"]
                add_change(current, "中断任务", {"command": prefix})
            tail = stripped[len(prefix):].strip()
            if not tail:
                sessions["active_task_id"] = None
                save_sessions(config, sessions)
                return f"当前任务已中断。请发送新的询价内容以创建新任务。\n\n{command_help()}"
            fields = extract_fields(tail)
            batch_items = extract_batch_items(tail)
            if len(batch_items) >= 2:
                fields = batch_base_fields(fields)
            task = create_task(sessions, tail, fields, batch_items)
            return run_stage1(config, sessions, task, "中断旧任务并创建新询价")
    return None


def merge_fields(old: Dict[str, Any], new: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    merged = deepcopy(old)
    changes = {}
    for key, value in new.items():
        if value in [None, ""]:
            continue
        if merged.get(key) != value:
            changes[key] = {"from": merged.get(key), "to": value}
            merged[key] = value
    return merged, changes


def process_message(message: str) -> str:
    config = load_config()
    sessions = load_sessions(config)

    command_result = handle_command(config, sessions, message)
    if command_result is not None:
        return command_result

    task = active_task(sessions)
    if is_margin_message(message):
        if not task:
            return "当前没有活动报价任务，无法应用毛利率。请先发送客户询价。"
        return run_stage2(config, sessions, task, message)

    prefer_last = is_modification_message(message)
    fields = extract_fields(message, prefer_last_code=prefer_last)
    batch_items = extract_batch_items(message)
    if len(batch_items) >= 2:
        fields = batch_base_fields(fields)

    if task and task.get("status") not in [STATUSES["COMPLETED"], STATUSES["INTERRUPTED"]]:
        if is_modification_message(message) or (task.get("status") == STATUSES["WAITING_INFO"] and fields):
            merged, changes = merge_fields(task.get("extracted_fields", {}), fields)
            if not changes:
                return "已检测到这是修改/补充信息，但没有识别到可更新字段。请补充更明确的仓库、重量、体积、税务类型或运输方式。"
            task["extracted_fields"] = merged
            add_change(task, "修改询价字段", {"message": message, "changes": changes})
            return run_stage1(config, sessions, task, "更新询价信息并重新查询成本")

        if fields:
            return "请确认：这是新的报价任务，还是对当前任务的修改？如需强制开启新任务，请使用 /中断并新开。"

    task = create_task(sessions, message, fields, batch_items)
    return run_stage1(config, sessions, task, "创建询价并查询成本")


def main() -> None:
    if len(sys.argv) < 2:
        print("请输入询价内容或命令。例如：run_quote.bat \"LAX9，300kg，深圳仓，包税，有什么方案？\"")
        raise SystemExit(2)
    message = " ".join(sys.argv[1:])
    message = message.replace("\\n", "\n")
    print(process_message(message))


if __name__ == "__main__":
    main()
