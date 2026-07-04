# MonShield Tracker backend — Railway-ready.
# nautilus_trader ships prebuilt manylinux wheels, so no Rust toolchain or
# compilers are needed here; a slim Python base is enough.
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway injects PORT at runtime; default to 8080 for local docker runs.
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
