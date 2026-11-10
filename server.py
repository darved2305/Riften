"""Vercel entrypoint, serving the real FastAPI API and the built React client."""
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from backend.main import app

bundle=Path(__file__).resolve().parent/'dist'
if bundle.is_dir():app.mount('/',StaticFiles(directory=str(bundle),html=True),name='riften-frontend')
