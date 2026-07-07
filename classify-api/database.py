from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

DATABASE_URL = "sqlite:///./classify.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class FeedbackRecord(Base):
    __tablename__ = "feedbacks"

    id = Column(Integer, primary_key=True, index=True)
    image_url = Column(Text, nullable=True)
    ai_category = Column(String(50))      # AI가 예측한 카테고리
    correct_category = Column(String(50)) # 사용자가 수정한 카테고리
    confidence = Column(Float, nullable=True)
    embedding = Column(Text, nullable=True)  # JSON 직렬화된 임베딩
    created_at = Column(DateTime, default=datetime.utcnow)


class TrainingHistory(Base):
    __tablename__ = "training_history"

    id = Column(Integer, primary_key=True, index=True)
    trained_at = Column(DateTime, default=datetime.utcnow)
    sample_count = Column(Integer)
    accuracy = Column(Float, nullable=True)
    model_version = Column(String(50))
    notes = Column(Text, nullable=True)


class ClassifyLog(Base):
    __tablename__ = "classify_logs"

    id = Column(Integer, primary_key=True, index=True)
    image_url = Column(Text, nullable=True)
    predicted_category = Column(String(50))
    confidence = Column(Float)
    model_version = Column(String(50))  # "clip_zero_shot" or "fine_tuned_vN"
    was_corrected = Column(Integer, default=0)  # 0=모름, 1=맞음, 2=틀림
    created_at = Column(DateTime, default=datetime.utcnow)


class ExportUpload(Base):
    __tablename__ = "export_uploads"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255))
    row_count = Column(Integer, default=0)
    uploaded_at = Column(DateTime, default=datetime.utcnow)


class ExportCar(Base):
    __tablename__ = "export_cars"

    id = Column(Integer, primary_key=True, index=True)
    upload_id = Column(Integer, nullable=True)
    brand = Column(String(100), nullable=True)            # 메이커
    model = Column(String(100), nullable=True)            # 모델
    car_type = Column(String(50), nullable=True)          # 타입 (Sedan/SUV/Coupe...)
    year = Column(Integer, nullable=True)                 # 연식
    mileage = Column(Integer, nullable=True)              # 마일리지(km)
    engine_cc = Column(Integer, nullable=True)            # 배기량
    fuel = Column(String(50), nullable=True)              # 연료
    transmission = Column(String(50), nullable=True)      # 미션
    drive_type = Column(String(20), nullable=True)        # 구동방식 (2WD/4WD)
    color = Column(String(100), nullable=True)            # 색상
    seats = Column(Integer, nullable=True)                # 좌석수
    export_price_usd = Column(Float, nullable=True)       # 판매금액(USD)
    export_country = Column(String(100), nullable=True)   # 판매나라
    volume_m3 = Column(Float, nullable=True)              # m3 (선적부피)
    has_sunroof = Column(Boolean, default=False)          # 선루프
    has_pushstart = Column(Boolean, default=False)        # 푸쉬스타트
    purchase_price_krw = Column(Integer, nullable=True)   # 매입가(원) — 별도 입력용
    export_date = Column(String(20), nullable=True)       # 수출일
    notes = Column(Text, nullable=True)                   # 비고
    created_at = Column(DateTime, default=datetime.utcnow)


class ExportSetting(Base):
    __tablename__ = "export_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, index=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
