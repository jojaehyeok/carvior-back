"""
수출 원데이터 분석 API 라우터
- POST /export/upload         : Excel 업로드 및 파싱
- GET  /export/uploads        : 업로드 이력
- DELETE /export/uploads/{id} : 업로드 삭제
- GET  /export/stats          : 종합 통계
- GET  /export/cars           : 차량 목록 (필터/페이징)
- GET  /export/simulator      : 매입가 시뮬레이터
- GET  /export/settings       : 설정 조회
- PUT  /export/settings       : 설정 저장
"""
import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import ExportCar, ExportSetting, ExportUpload, get_db

router = APIRouter(prefix="/export", tags=["export"])

# ── 컬럼 매핑 ─────────────────────────────────────────────────────────────────
# 각 필드에 매칭될 수 있는 Excel 헤더 후보 (소문자 비교)
_COL_CANDIDATES: dict[str, list[str]] = {
    "brand":            ["메이커", "브랜드", "제조사", "make", "brand"],
    "model":            ["모델", "모델명", "차종", "model"],
    "car_type":         ["타입", "차타입", "유형", "type", "차량유형"],
    "year":             ["연식", "year", "연도", "제조연도"],
    "mileage":          ["마일리지", "주행거리", "km", "mileage", "키로수", "주행거리(km)"],
    "engine_cc":        ["배기량", "cc", "engine", "엔진"],
    "fuel":             ["연료", "연료종류", "fuel"],
    "transmission":     ["미션", "변속기", "transmission", "gearbox"],
    "drive_type":       ["구동방식", "구동", "drive", "드라이브"],
    "color":            ["색상", "color", "차색"],
    "seats":            ["seat", "좌석", "시트", "seats"],
    "export_price_usd": ["판매금액", "판매가", "판매금", "수출가", "수출금액", "export", "price", "판매가격", "수출가격"],
    "export_country":   ["판매나라", "수출국", "나라", "국가", "country", "destination"],
    "volume_m3":        ["m3", "cbm", "부피", "체적"],
    "has_sunroof":      ["선루프", "sunroof"],
    "has_pushstart":    ["푸쉬스타트", "push start", "pushstart", "스타트"],
    "purchase_price_krw": ["매입가", "구매가", "매입금액", "구매가격", "purchase"],
    "export_date":      ["수출일", "수출날짜", "date", "수출일자", "계약일"],
    "notes":            ["비고", "메모", "notes", "note", "remarks"],
}


def _match_column(header: str) -> Optional[str]:
    h = header.strip().lower()
    for field, candidates in _COL_CANDIDATES.items():
        for c in candidates:
            if c.lower() == h or c.lower() in h or h in c.lower():
                return field
    return None


# ── 엑셀 파싱 ─────────────────────────────────────────────────────────────────

def _parse_excel(file_bytes: bytes) -> list[dict]:
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
    except Exception:
        try:
            import pandas as pd
            df = pd.read_excel(io.BytesIO(file_bytes))
            rows = [tuple(df.columns)] + [tuple(r) for r in df.itertuples(index=False)]
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Excel 파싱 실패: {e}")

    if len(rows) < 2:
        raise HTTPException(status_code=400, detail="데이터가 없습니다 (헤더 + 최소 1행 필요)")

    # 헤더 행 자동 탐지: 처음 10행 중 매핑 히트 가장 많은 행
    header_row_idx = 0
    best_score = 0
    for i, row in enumerate(rows[:10]):
        score = sum(1 for cell in row if cell and _match_column(str(cell)) is not None)
        if score > best_score:
            best_score = score
            header_row_idx = i

    if best_score == 0:
        raise HTTPException(status_code=400, detail="인식 가능한 헤더를 찾을 수 없습니다")

    headers = [str(c).strip() if c is not None else "" for c in rows[header_row_idx]]
    col_map: dict[int, str] = {}
    for idx, h in enumerate(headers):
        field = _match_column(h)
        if field and field not in col_map.values():
            col_map[idx] = field

    results = []
    for row in rows[header_row_idx + 1:]:
        if not any(c is not None and str(c).strip() for c in row):
            continue
        item: dict = {}
        for idx, field in col_map.items():
            item[field] = row[idx] if idx < len(row) else None
        results.append(item)
    return results


# ── 데이터 정제 ───────────────────────────────────────────────────────────────

def _to_int(v) -> Optional[int]:
    if v is None:
        return None
    try:
        return int(str(v).replace(",", "").replace(" ", "").replace("km", "").replace("cc", "").strip())
    except Exception:
        return None


def _to_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(str(v).replace(",", "").replace(" ", "").replace("$", "").replace("USD", "").strip())
    except Exception:
        return None


def _to_bool(v) -> bool:
    if v is None:
        return False
    s = str(v).strip().upper()
    return s in ("O", "YES", "Y", "TRUE", "1", "있음", "선루프", "O ")


def _clean_car(raw: dict, upload_id: int) -> ExportCar:
    year_val = raw.get("year")
    year = None
    if year_val is not None:
        try:
            year = int(str(year_val).strip()[:4])
        except Exception:
            pass

    export_date = raw.get("export_date")
    if export_date is not None:
        try:
            if hasattr(export_date, "strftime"):
                export_date = export_date.strftime("%Y-%m-%d")
            else:
                export_date = str(export_date).strip()[:10]
        except Exception:
            export_date = str(export_date)

    seats_val = _to_int(raw.get("seats"))
    vol_val = _to_float(raw.get("volume_m3"))

    return ExportCar(
        upload_id=upload_id,
        brand=str(raw.get("brand") or "").strip() or None,
        model=str(raw.get("model") or "").strip() or None,
        car_type=str(raw.get("car_type") or "").strip() or None,
        year=year,
        mileage=_to_int(raw.get("mileage")),
        engine_cc=_to_int(raw.get("engine_cc")),
        fuel=str(raw.get("fuel") or "").strip() or None,
        transmission=str(raw.get("transmission") or "").strip() or None,
        drive_type=str(raw.get("drive_type") or "").strip() or None,
        color=str(raw.get("color") or "").strip() or None,
        seats=seats_val,
        export_price_usd=_to_float(raw.get("export_price_usd")),
        export_country=str(raw.get("export_country") or "").strip() or None,
        volume_m3=vol_val,
        has_sunroof=_to_bool(raw.get("has_sunroof")),
        has_pushstart=_to_bool(raw.get("has_pushstart")),
        purchase_price_krw=_to_int(raw.get("purchase_price_krw")),
        export_date=export_date,
        notes=str(raw.get("notes") or "").strip() or None,
    )


def _get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.query(ExportSetting).filter(ExportSetting.key == key).first()
    return row.value if row else default


# ── 업로드 ────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_excel(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not (file.filename or "").endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail=".xlsx 또는 .xls 파일만 허용됩니다")

    content = await file.read()
    raw_rows = _parse_excel(content)

    upload = ExportUpload(filename=file.filename, row_count=0)
    db.add(upload)
    db.flush()

    cars = [_clean_car(r, upload.id) for r in raw_rows]
    db.bulk_save_objects(cars)
    upload.row_count = len(cars)
    db.commit()

    return {"ok": True, "upload_id": upload.id, "filename": file.filename, "row_count": len(cars)}


@router.get("/uploads")
async def list_uploads(db: Session = Depends(get_db)):
    uploads = db.query(ExportUpload).order_by(ExportUpload.uploaded_at.desc()).all()
    return [
        {"id": u.id, "filename": u.filename, "row_count": u.row_count,
         "uploaded_at": u.uploaded_at.isoformat()}
        for u in uploads
    ]


@router.delete("/uploads/{upload_id}")
async def delete_upload(upload_id: int, db: Session = Depends(get_db)):
    upload = db.query(ExportUpload).filter(ExportUpload.id == upload_id).first()
    if not upload:
        raise HTTPException(status_code=404, detail="업로드를 찾을 수 없습니다")
    db.query(ExportCar).filter(ExportCar.upload_id == upload_id).delete()
    db.delete(upload)
    db.commit()
    return {"ok": True}


# ── 통계 ──────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def export_stats(db: Session = Depends(get_db)):
    usd_rate = int(_get_setting(db, "usd_rate", "1530"))
    other_cost_krw = int(_get_setting(db, "other_cost_krw", "1500000"))
    shipping_per_m3 = float(_get_setting(db, "shipping_per_m3", "50"))

    total = db.query(func.count(ExportCar.id)).scalar() or 0
    avg_export = db.query(func.avg(ExportCar.export_price_usd)).scalar()

    # 차종별 집계 (브랜드+모델 기준)
    model_stats = db.query(
        ExportCar.brand,
        ExportCar.model,
        ExportCar.car_type,
        func.count(ExportCar.id).label("cnt"),
        func.avg(ExportCar.export_price_usd).label("avg_usd"),
        func.avg(ExportCar.mileage).label("avg_mileage"),
        func.avg(ExportCar.year).label("avg_year"),
        func.avg(ExportCar.volume_m3).label("avg_m3"),
    ).filter(
        ExportCar.model != None,
        ExportCar.export_price_usd != None,
    ).group_by(
        ExportCar.brand, ExportCar.model, ExportCar.car_type
    ).order_by(func.count(ExportCar.id).desc()).limit(30).all()

    def calc_max_purchase(avg_usd, avg_m3):
        if avg_usd is None:
            return None
        avg_krw = avg_usd * usd_rate
        # m3 데이터 있으면 m3×$50 운임, 없으면 10% 플랫
        if avg_m3:
            shipping_krw = avg_m3 * shipping_per_m3 * usd_rate
        else:
            shipping_krw = avg_krw * 0.1
        return round(avg_krw - shipping_krw - other_cost_krw)

    # 수출국별
    country_stats = db.query(
        ExportCar.export_country,
        func.count(ExportCar.id).label("cnt"),
        func.avg(ExportCar.export_price_usd).label("avg_usd"),
    ).filter(ExportCar.export_country != None).group_by(
        ExportCar.export_country
    ).order_by(func.count(ExportCar.id).desc()).limit(20).all()

    # 타입별 (Sedan/SUV 등)
    type_stats = db.query(
        ExportCar.car_type,
        func.count(ExportCar.id).label("cnt"),
        func.avg(ExportCar.export_price_usd).label("avg_usd"),
    ).filter(ExportCar.car_type != None).group_by(
        ExportCar.car_type
    ).order_by(func.count(ExportCar.id).desc()).all()

    # 연식별
    year_stats = db.query(
        ExportCar.year,
        func.count(ExportCar.id).label("cnt"),
        func.avg(ExportCar.export_price_usd).label("avg_usd"),
    ).filter(ExportCar.year != None).group_by(
        ExportCar.year
    ).order_by(ExportCar.year.desc()).limit(15).all()

    return {
        "total_cars": total,
        "avg_export_price_usd": round(avg_export, 0) if avg_export else None,
        "usd_rate": usd_rate,
        "other_cost_krw": other_cost_krw,
        "shipping_per_m3": shipping_per_m3,
        "model_stats": [
            {
                "brand": r.brand,
                "model": r.model,
                "car_type": r.car_type,
                "count": r.cnt,
                "avg_export_usd": round(r.avg_usd, 0) if r.avg_usd else None,
                "avg_export_krw": round(r.avg_usd * usd_rate) if r.avg_usd else None,
                "avg_mileage": round(r.avg_mileage) if r.avg_mileage else None,
                "avg_year": round(r.avg_year, 1) if r.avg_year else None,
                "avg_m3": round(r.avg_m3, 2) if r.avg_m3 else None,
                "max_purchase_krw": calc_max_purchase(r.avg_usd, r.avg_m3),
            }
            for r in model_stats
        ],
        "country_stats": [
            {"country": r.export_country, "count": r.cnt,
             "avg_export_usd": round(r.avg_usd, 0) if r.avg_usd else None}
            for r in country_stats
        ],
        "type_stats": [
            {"car_type": r.car_type, "count": r.cnt,
             "avg_export_usd": round(r.avg_usd, 0) if r.avg_usd else None}
            for r in type_stats
        ],
        "year_stats": [
            {"year": r.year, "count": r.cnt,
             "avg_export_usd": round(r.avg_usd, 0) if r.avg_usd else None}
            for r in year_stats
        ],
    }


# ── 차량 목록 ─────────────────────────────────────────────────────────────────

@router.get("/cars")
async def list_cars(
    db: Session = Depends(get_db),
    brand: Optional[str] = Query(None),
    model: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    car_type: Optional[str] = Query(None),
    year_min: Optional[int] = Query(None),
    year_max: Optional[int] = Query(None),
    upload_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    q = db.query(ExportCar)
    if brand:
        q = q.filter(ExportCar.brand.ilike(f"%{brand}%"))
    if model:
        q = q.filter(ExportCar.model.ilike(f"%{model}%"))
    if country:
        q = q.filter(ExportCar.export_country.ilike(f"%{country}%"))
    if car_type:
        q = q.filter(ExportCar.car_type.ilike(f"%{car_type}%"))
    if year_min:
        q = q.filter(ExportCar.year >= year_min)
    if year_max:
        q = q.filter(ExportCar.year <= year_max)
    if upload_id:
        q = q.filter(ExportCar.upload_id == upload_id)

    total = q.count()
    cars = q.order_by(ExportCar.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "cars": [
            {
                "id": c.id,
                "brand": c.brand, "model": c.model, "car_type": c.car_type,
                "year": c.year, "mileage": c.mileage,
                "engine_cc": c.engine_cc, "fuel": c.fuel,
                "transmission": c.transmission, "drive_type": c.drive_type,
                "color": c.color, "seats": c.seats,
                "export_price_usd": c.export_price_usd,
                "export_country": c.export_country,
                "volume_m3": c.volume_m3,
                "has_sunroof": c.has_sunroof, "has_pushstart": c.has_pushstart,
            }
            for c in cars
        ],
    }


# ── 시뮬레이터 ────────────────────────────────────────────────────────────────
# 공식: 운임비USD = 평균m3 × shipping_rate_per_m3(기본 $50)
#       권장최대매입가KRW = 평균판매가KRW - (운임비USD × 환율) - 기타비용KRW
# 예: Tucson avg_usd=7,215 × 1,530=11,038,950  m3≈14.4 → 운임비=720USD=1,101,600
#     권장매입가 = 11,038,950 - 1,101,600 - 1,500,000 = 8,437,350

@router.get("/simulator")
async def simulator(
    db: Session = Depends(get_db),
    brand: Optional[str] = Query(None),
    model: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    mileage: Optional[int] = Query(None),
):
    usd_rate = int(_get_setting(db, "usd_rate", "1530"))
    other_cost_krw = int(_get_setting(db, "other_cost_krw", "1500000"))
    shipping_per_m3 = float(_get_setting(db, "shipping_per_m3", "50"))  # USD per m3

    q = db.query(ExportCar).filter(ExportCar.export_price_usd != None)
    if brand:
        q = q.filter(ExportCar.brand.ilike(f"%{brand}%"))
    if model:
        q = q.filter(ExportCar.model.ilike(f"%{model}%"))
    if year:
        q = q.filter(ExportCar.year == year)

    similar = q.all()
    if not similar:
        return {"ok": False, "reason": "유사 차량 데이터가 없습니다"}

    # 주행거리 가중 평균
    def weight(c: ExportCar) -> float:
        if mileage is None or c.mileage is None:
            return 1.0
        diff = abs(c.mileage - mileage)
        return max(0.05, 1.0 - diff / 150_000)

    weights = [weight(c) for c in similar]
    total_w = sum(weights)

    avg_export_usd = sum((c.export_price_usd or 0) * w for c, w in zip(similar, weights)) / total_w
    avg_mileage = sum((c.mileage or 0) * w for c, w in zip(similar, weights)) / total_w if any(c.mileage for c in similar) else None
    avg_year_val = sum((c.year or 0) * w for c, w in zip(similar, weights)) / total_w if any(c.year for c in similar) else None

    # m3 기반 운임비 계산 (m3 데이터가 없으면 10% 플랫 fallback)
    has_m3 = any(c.volume_m3 for c in similar)
    if has_m3:
        avg_m3 = sum((c.volume_m3 or 0) * w for c, w in zip(similar, weights)) / total_w
        shipping_usd = avg_m3 * shipping_per_m3
    else:
        avg_m3 = None
        shipping_usd = avg_export_usd * 0.1  # fallback

    avg_export_krw = avg_export_usd * usd_rate
    shipping_krw = shipping_usd * usd_rate
    max_purchase_krw = round(avg_export_krw - shipping_krw - other_cost_krw)

    # 주요 수출국
    from collections import Counter
    countries = [c.export_country for c in similar if c.export_country]
    top_country = Counter(countries).most_common(1)[0][0] if countries else None

    return {
        "ok": True,
        "sample_count": len(similar),
        "avg_export_price_usd": round(avg_export_usd, 0),
        "avg_export_price_krw": round(avg_export_krw),
        "avg_mileage": round(avg_mileage) if avg_mileage else None,
        "avg_year": round(avg_year_val, 1) if avg_year_val else None,
        "avg_m3": round(avg_m3, 2) if avg_m3 else None,
        "top_export_country": top_country,
        "shipping_usd": round(shipping_usd, 0),
        "shipping_krw": round(shipping_krw),
        "other_cost_krw": other_cost_krw,
        "shipping_per_m3": shipping_per_m3,
        "usd_rate": usd_rate,
        "max_purchase_krw": max_purchase_krw,
    }


# ── 설정 ──────────────────────────────────────────────────────────────────────

_DEFAULT_SETTINGS = {
    "usd_rate": "1530",
    "other_cost_krw": "1500000",
    "shipping_per_m3": "50",  # USD per m3 (전장×전폭×전고 × $50 = 운임비)
}


@router.get("/settings")
async def get_settings(db: Session = Depends(get_db)):
    rows = db.query(ExportSetting).all()
    result = dict(_DEFAULT_SETTINGS)
    for r in rows:
        result[r.key] = r.value
    return result


@router.put("/settings")
async def update_settings(data: dict, db: Session = Depends(get_db)):
    for key, value in data.items():
        row = db.query(ExportSetting).filter(ExportSetting.key == key).first()
        if row:
            row.value = str(value)
            row.updated_at = datetime.utcnow()
        else:
            db.add(ExportSetting(key=key, value=str(value)))
    db.commit()
    return {"ok": True}
