FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install uv && uv pip install --system --no-cache -r requirements.txt

COPY backend/ /app/backend/
COPY models.py /app/models.py

EXPOSE 7860

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
