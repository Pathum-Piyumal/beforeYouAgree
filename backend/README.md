# Backend

## Setup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in real values

## Run
uvicorn app.main:app --reload --port 8000