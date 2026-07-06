"""
차량 사진 분류 FastAPI 서버
- POST /classify  : 이미지 분류
- POST /feedback  : 피드백 저장 (능동 학습)
- POST /train     : 수동 재학습 트리거
- GET  /stats     : 통계 (JSON)
- GET  /dashboard : HTML 대시보드
"""
import io
import json
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from PIL import Image
from sqlalchemy.orm import Session

from classifier import CATEGORY_LABELS, MIN_SAMPLES_TO_TRAIN, get_classifier
from database import ClassifyLog, FeedbackRecord, TrainingHistory, get_db, init_db

# ── 앱 초기화 ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    get_classifier()  # 서버 시작 시 모델 미리 로드
    yield

app = FastAPI(title="차량 사진 분류 API", version="1.0.0", lifespan=lifespan, root_path="/classify-api")
templates = Jinja2Templates(directory="templates")


# ── 유틸 ───────────────────────────────────────────────────────────────────────
async def load_image_from_source(
    file: Optional[UploadFile] = None,
    url: Optional[str] = None,
) -> Image.Image:
    if file:
        data = await file.read()
        return Image.open(io.BytesIO(data)).convert("RGB")
    if url:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return Image.open(io.BytesIO(resp.content)).convert("RGB")
    raise HTTPException(status_code=400, detail="file 또는 url 중 하나가 필요합니다")


def auto_train_if_ready(db: Session):
    """피드백이 충분히 쌓이면 자동 재학습"""
    count = db.query(FeedbackRecord).count()
    # 50개마다 자동 학습
    if count >= MIN_SAMPLES_TO_TRAIN and count % MIN_SAMPLES_TO_TRAIN == 0:
        feedbacks = db.query(FeedbackRecord).all()
        clf = get_classifier()
        result = clf.train_from_feedback(feedbacks)
        if result["ok"]:
            history = TrainingHistory(
                sample_count=result["samples"],
                accuracy=result["accuracy"],
                model_version=result["model_version"],
                notes="자동 학습",
            )
            db.add(history)
            db.commit()
            print(f"[AutoTrain] 완료: {result}")


# ── 엔드포인트 ─────────────────────────────────────────────────────────────────

@app.post("/classify")
async def classify(
    db: Session = Depends(get_db),
    file: Optional[UploadFile] = File(None),
    url: Optional[str] = Form(None),
    category: Optional[str] = Form(None),  # 기존 백엔드 호환용 (무시)
):
    """이미지를 카테고리로 분류합니다"""
    image = await load_image_from_source(file, url)
    clf = get_classifier()
    result = clf.classify(image)

    # 분류 로그 저장
    log = ClassifyLog(
        image_url=url,
        predicted_category=result["category"],
        confidence=result["confidence"],
        model_version=result["model_version"],
    )
    db.add(log)
    db.commit()
    db.refresh(log)

    return {
        "category": result["category"],
        "label": _category_label(result["category"]),
        "confidence": round(result["confidence"], 3),
        "model_version": result["model_version"],
        "log_id": log.id,
    }


@app.post("/feedback")
async def feedback(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    image_url: Optional[str] = Form(None),
    ai_category: str = Form(...),
    correct_category: str = Form(...),
    log_id: Optional[int] = Form(None),
):
    """AI 분류 결과를 사용자가 수정 → 피드백 저장"""
    if correct_category not in CATEGORY_LABELS:
        raise HTTPException(status_code=400, detail=f"올바르지 않은 카테고리: {correct_category}")

    # 이미지 임베딩 계산 (URL 있을 때)
    embedding_json = None
    if image_url:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(image_url)
                image = Image.open(io.BytesIO(resp.content)).convert("RGB")
            clf = get_classifier()
            emb = clf.get_image_embedding(image)
            embedding_json = json.dumps(emb.tolist())
        except Exception as e:
            print(f"[Feedback] 임베딩 계산 실패: {e}")

    record = FeedbackRecord(
        image_url=image_url,
        ai_category=ai_category,
        correct_category=correct_category,
        embedding=embedding_json,
    )
    db.add(record)

    # 분류 로그 업데이트
    if log_id:
        log = db.query(ClassifyLog).filter(ClassifyLog.id == log_id).first()
        if log:
            log.was_corrected = 2 if ai_category != correct_category else 1

    db.commit()

    # 백그라운드에서 자동 재학습 체크
    background_tasks.add_task(auto_train_if_ready, db)

    total = db.query(FeedbackRecord).count()
    next_train_at = ((total // MIN_SAMPLES_TO_TRAIN) + 1) * MIN_SAMPLES_TO_TRAIN
    remaining = next_train_at - total

    return {
        "ok": True,
        "total_feedbacks": total,
        "next_auto_train_in": remaining,
        "message": f"피드백 저장 완료 ({total}개 누적, {remaining}개 더 쌓이면 자동 학습)",
    }


@app.post("/train")
async def train_now(db: Session = Depends(get_db)):
    """수동으로 재학습 트리거"""
    feedbacks = db.query(FeedbackRecord).all()
    clf = get_classifier()
    result = clf.train_from_feedback(feedbacks)

    if not result["ok"]:
        return {"ok": False, "reason": result["reason"]}

    history = TrainingHistory(
        sample_count=result["samples"],
        accuracy=result["accuracy"],
        model_version=result["model_version"],
        notes="수동 학습",
    )
    db.add(history)
    db.commit()

    return {
        "ok": True,
        "samples_used": result["samples"],
        "train_accuracy": round(result["accuracy"], 3),
        "model_version": result["model_version"],
    }


@app.get("/stats")
async def stats(db: Session = Depends(get_db)):
    """학습 통계 JSON"""
    clf = get_classifier()
    total_feedbacks = db.query(FeedbackRecord).count()
    total_classifies = db.query(ClassifyLog).count()
    corrected = db.query(ClassifyLog).filter(ClassifyLog.was_corrected == 2).count()
    correct = db.query(ClassifyLog).filter(ClassifyLog.was_corrected == 1).count()

    # 카테고리별 피드백 분포
    from sqlalchemy import func
    cat_dist = db.query(
        FeedbackRecord.correct_category,
        func.count(FeedbackRecord.id)
    ).group_by(FeedbackRecord.correct_category).all()

    # AI 오분류 패턴
    wrong_pattern = db.query(
        FeedbackRecord.ai_category,
        FeedbackRecord.correct_category,
        func.count(FeedbackRecord.id).label("cnt")
    ).filter(
        FeedbackRecord.ai_category != FeedbackRecord.correct_category
    ).group_by(
        FeedbackRecord.ai_category, FeedbackRecord.correct_category
    ).order_by(func.count(FeedbackRecord.id).desc()).limit(10).all()

    # 학습 이력
    history = db.query(TrainingHistory).order_by(TrainingHistory.trained_at.desc()).limit(10).all()

    return {
        "model_version": clf.model_version,
        "total_feedbacks": total_feedbacks,
        "total_classifies": total_classifies,
        "corrected_count": corrected,
        "correct_count": correct,
        "accuracy_rate": round(correct / (correct + corrected), 3) if (correct + corrected) > 0 else None,
        "next_auto_train_in": max(0, MIN_SAMPLES_TO_TRAIN - (total_feedbacks % MIN_SAMPLES_TO_TRAIN)),
        "category_distribution": {cat: cnt for cat, cnt in cat_dist},
        "top_wrong_patterns": [
            {"ai_said": r.ai_category, "correct": r.correct_category, "count": r.cnt}
            for r in wrong_pattern
        ],
        "training_history": [
            {
                "trained_at": h.trained_at.isoformat(),
                "samples": h.sample_count,
                "accuracy": h.accuracy,
                "version": h.model_version,
                "notes": h.notes,
            }
            for h in history
        ],
    }


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request, db: Session = Depends(get_db)):
    """HTML 대시보드"""
    s = await stats(db)
    return templates.TemplateResponse("dashboard.html", {"request": request, "stats": s})


@app.get("/health")
async def health():
    clf = get_classifier()
    return {"status": "ok", "model_version": clf.model_version}


# ── 번호판 감지 ────────────────────────────────────────────────────────────────
@app.post("/detect-plates")
async def detect_plates(
    url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    """번호판 bounding box 감지 → [{xmin,ymin,xmax,ymax}, ...]"""
    try:
        image = await load_image_from_source(file, url)
        boxes = _find_plate_boxes(image)
        return {"boxes": boxes}
    except Exception as e:
        return {"boxes": [], "error": str(e)}


def _find_plate_boxes(image: Image.Image):
    """
    PIL + numpy 기반 번호판 감지.
    한국 번호판: 흰색 직사각형, 가로세로비 3.5~5.5:1, 이미지 하단 50% 위치.
    """
    import numpy as np
    from PIL import ImageFilter

    w, h = image.size
    gray_pil = image.convert("L")
    gray = np.array(gray_pil, dtype=np.float32)
    edges = np.array(gray_pil.filter(ImageFilter.FIND_EDGES), dtype=np.float32)

    # RGB 기반 흰색 마스크 (한국 번호판은 흰색)
    rgb = np.array(image.convert("RGB"))
    white_mask = (
        (rgb[:, :, 0] > 200) &
        (rgb[:, :, 1] > 200) &
        (rgb[:, :, 2] > 200)
    ).astype(np.float32)

    best_score = 0.0
    best_box: dict | None = None

    # 번호판은 이미지 하단 50%에 위치 (상단 50% 제외로 건물·하늘 오감지 방지)
    y_start = int(h * 0.5)

    for ph_ratio in [0.06, 0.08, 0.10, 0.12]:
        ph = max(10, int(h * ph_ratio))
        for aspect in [3.5, 4.2, 5.0, 5.5]:
            pw = int(ph * aspect)
            if pw > w * 0.65 or pw < 40:
                continue

            step_y = max(ph // 3, 4)
            step_x = max(pw // 5, 6)

            for y in range(y_start, h - ph, step_y):
                for x in range(int(w * 0.05), w - pw - int(w * 0.05), step_x):
                    region_white = white_mask[y:y+ph, x:x+pw]
                    white_score  = float(region_white.mean())

                    # 흰색 비율 40% 미만이면 번호판 아님
                    if white_score < 0.40:
                        continue

                    region_gray  = gray[y:y+ph, x:x+pw]
                    region_edges = edges[y:y+ph, x:x+pw]
                    bright_score = float((region_gray > 180).mean())
                    edge_score   = float(region_edges.mean() / 255.0)

                    score = white_score * 0.40 + bright_score * 0.30 + edge_score * 0.30
                    if score > best_score:
                        best_score = score
                        best_box = {"xmin": int(x), "ymin": int(y),
                                    "xmax": int(x + pw), "ymax": int(y + ph)}

    if best_box and best_score > 0.45:
        return [best_box]
    return []


# ── 헬퍼 ───────────────────────────────────────────────────────────────────────
_LABEL_MAP = {
    "dashboard": "계기판", "registration": "자동차등록증", "vin": "보험이력",
    "exterior": "외관", "wheel": "휠", "undercarriage": "하체",
    "interior": "실내", "engine": "엔진룸", "extra": "옵션", "damage": "외판 데미지",
}

def _category_label(cat_id: str) -> str:
    return _LABEL_MAP.get(cat_id, cat_id)
