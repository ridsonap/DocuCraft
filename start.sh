#!/bin/sh
set -e

echo "Starting DocuCraft Backend (FastAPI)..."
cd /app/backend
uvicorn main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

echo "Waiting for backend to be ready..."
until curl -s http://127.0.0.1:8000/health > /dev/null; do
  sleep 0.5
done
echo "Backend is ready!"

echo "Starting DocuCraft Frontend (Next.js)..."
cd /app
export BACKEND_INTERNAL_URL="http://127.0.0.1:8000"
export PORT=${PORT:-3000}
node server.js &
FRONTEND_PID=$!

# Trap signals and forward to children
trap "kill -TERM $BACKEND_PID $FRONTEND_PID" INT TERM EXIT

# Wait on children
wait -n $BACKEND_PID $FRONTEND_PID
