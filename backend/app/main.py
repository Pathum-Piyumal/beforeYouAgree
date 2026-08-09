from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Contract Gaurd API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  #tighten this later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]

)

@app.get("/health")
def health_check():
    return {"status":"ok"}
    
