FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y build-essential curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy everything, not just backend/
COPY . .

EXPOSE 7860

ENV PYTHONUNBUFFERED=1

# Match what openenv.yaml declares: app: server.app:app
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "7860"]
