"""
CLIP 기반 차량 사진 분류기
- Phase 1: CLIP zero-shot (즉시 사용, 학습 불필요)
- Phase 2: 피드백 50개 이상 쌓이면 LogisticRegression head fine-tuning
"""
import json
import os
import pickle
import numpy as np
from PIL import Image
import open_clip
import torch
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import LabelEncoder
from typing import Optional

# ── 카테고리 정의 ──────────────────────────────────────────────────────────────
CATEGORIES = {
    "dashboard": [
        "car dashboard with speedometer and odometer",
        "계기판 속도계 주행거리",
        "instrument cluster mileage display",
    ],
    "registration": [
        "자동차등록증 vehicle registration certificate document",
        "car registration card paper document",
        "Korean vehicle registration document",
    ],
    "vin": [
        "보험이력 car insurance history document",
        "vehicle insurance paper document",
        "자동차 보험 서류",
    ],
    "exterior": [
        "car exterior body panel side view",
        "차량 외관 도어 패널",
        "automobile exterior front rear side",
        "car body clean no damage",
    ],
    "wheel": [
        "car wheel tire alloy rim",
        "자동차 휠 타이어",
        "tire tread wheel close up",
    ],
    "undercarriage": [
        "car undercarriage chassis bottom view",
        "하체 차량 밑 프레임",
        "vehicle underbody rust inspection",
    ],
    "interior": [
        "car interior cabin seat steering wheel",
        "자동차 실내 좌석 핸들",
        "vehicle interior dashboard seats",
    ],
    "engine": [
        "car engine room hood open",
        "엔진룸 자동차 엔진",
        "engine bay compartment",
    ],
    "extra": [
        "car options accessories sunroof navigation",
        "자동차 옵션 선루프 후방카메라",
        "vehicle special features equipment",
    ],
    "damage": [
        "car body damage dent scratch",
        "차량 외판 데미지 찌그러짐 긁힘",
        "automobile body damage panel dent",
    ],
}

CATEGORY_LABELS = list(CATEGORIES.keys())
MODEL_PATH = "models/fine_tuned_head.pkl"
ENCODER_PATH = "models/label_encoder.pkl"
MIN_SAMPLES_TO_TRAIN = 50  # 이 이상 피드백 쌓이면 fine-tuning 활성화


class CarPhotoClassifier:
    def __init__(self):
        print("[Classifier] CLIP 모델 로딩 중...")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32", pretrained="openai"
        )
        self.model.to(self.device)
        self.model.eval()
        self.tokenizer = open_clip.get_tokenizer("ViT-B-32")

        # 카테고리 텍스트 임베딩 미리 계산
        self._text_embeddings = self._compute_text_embeddings()

        # fine-tuned head (피드백 충분하면 로드)
        self.fine_tuned_head: Optional[LogisticRegression] = None
        self.label_encoder: Optional[LabelEncoder] = None
        self.model_version = "clip_zero_shot"
        self._load_fine_tuned_if_exists()

        print(f"[Classifier] 준비 완료 (device={self.device}, version={self.model_version})")

    def _compute_text_embeddings(self) -> dict:
        embeddings = {}
        with torch.no_grad():
            for cat_id, texts in CATEGORIES.items():
                tokens = self.tokenizer(texts).to(self.device)
                text_emb = self.model.encode_text(tokens)
                text_emb = text_emb / text_emb.norm(dim=-1, keepdim=True)
                embeddings[cat_id] = text_emb.mean(dim=0)  # 여러 설명 평균
        return embeddings

    def get_image_embedding(self, image: Image.Image) -> np.ndarray:
        img_tensor = self.preprocess(image).unsqueeze(0).to(self.device)
        with torch.no_grad():
            emb = self.model.encode_image(img_tensor)
            emb = emb / emb.norm(dim=-1, keepdim=True)
        return emb.cpu().numpy().flatten()

    def classify(self, image: Image.Image) -> dict:
        embedding = self.get_image_embedding(image)

        # fine-tuned head 사용 (있으면)
        if self.fine_tuned_head is not None:
            proba = self.fine_tuned_head.predict_proba([embedding])[0]
            best_idx = int(np.argmax(proba))
            category = self.label_encoder.inverse_transform([best_idx])[0]
            confidence = float(proba[best_idx])

            # 신뢰도 낮으면 zero-shot 결과와 blending
            if confidence < 0.5:
                zs_result = self._zero_shot_classify(embedding)
                if zs_result["confidence"] > confidence:
                    return {**zs_result, "model_version": f"{self.model_version}_fallback"}

            return {
                "category": category,
                "confidence": confidence,
                "model_version": self.model_version,
                "embedding": embedding.tolist(),
            }

        # zero-shot
        return {**self._zero_shot_classify(embedding), "embedding": embedding.tolist()}

    def _zero_shot_classify(self, embedding: np.ndarray) -> dict:
        emb_tensor = torch.tensor(embedding).to(self.device)
        scores = {}
        for cat_id, text_emb in self._text_embeddings.items():
            score = float((emb_tensor * text_emb).sum())
            scores[cat_id] = score

        best_cat = max(scores, key=scores.get)
        # softmax로 confidence 계산
        vals = np.array(list(scores.values()))
        exp_vals = np.exp((vals - vals.max()) * 10)
        softmax = exp_vals / exp_vals.sum()
        best_conf = float(softmax[list(scores.keys()).index(best_cat)])

        return {
            "category": best_cat,
            "confidence": best_conf,
            "model_version": "clip_zero_shot",
            "scores": scores,
        }

    def train_from_feedback(self, feedbacks: list) -> dict:
        """피드백 데이터로 LogisticRegression head 학습"""
        if len(feedbacks) < MIN_SAMPLES_TO_TRAIN:
            return {"ok": False, "reason": f"샘플 부족 ({len(feedbacks)}/{MIN_SAMPLES_TO_TRAIN})"}

        X, y = [], []
        for fb in feedbacks:
            if fb.embedding:
                emb = json.loads(fb.embedding)
                X.append(emb)
                y.append(fb.correct_category)

        if len(X) < MIN_SAMPLES_TO_TRAIN:
            return {"ok": False, "reason": f"유효 임베딩 부족 ({len(X)})"}

        X = np.array(X)
        le = LabelEncoder()
        y_enc = le.fit_transform(y)

        clf = LogisticRegression(max_iter=1000, C=1.0, class_weight="balanced")
        clf.fit(X, y_enc)

        # 정확도 평가
        acc = float(clf.score(X, y_enc))

        # 저장
        os.makedirs("models", exist_ok=True)
        with open(MODEL_PATH, "wb") as f:
            pickle.dump(clf, f)
        with open(ENCODER_PATH, "wb") as f:
            pickle.dump(le, f)

        version_num = len([f for f in os.listdir("models") if f.startswith("fine_tuned")])
        self.fine_tuned_head = clf
        self.label_encoder = le
        self.model_version = f"fine_tuned_v{version_num}"

        return {
            "ok": True,
            "samples": len(X),
            "accuracy": acc,
            "model_version": self.model_version,
        }

    def _load_fine_tuned_if_exists(self):
        if os.path.exists(MODEL_PATH) and os.path.exists(ENCODER_PATH):
            with open(MODEL_PATH, "rb") as f:
                self.fine_tuned_head = pickle.load(f)
            with open(ENCODER_PATH, "rb") as f:
                self.label_encoder = pickle.load(f)
            self.model_version = "fine_tuned_loaded"
            print("[Classifier] fine-tuned 모델 로드됨")


# 싱글톤
_classifier_instance: Optional[CarPhotoClassifier] = None

def get_classifier() -> CarPhotoClassifier:
    global _classifier_instance
    if _classifier_instance is None:
        _classifier_instance = CarPhotoClassifier()
    return _classifier_instance
