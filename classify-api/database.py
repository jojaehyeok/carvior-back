from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text
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


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
