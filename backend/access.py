"""Read-only public demo with an owner-only editing session."""
import hashlib
import hmac
import os
import time
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix='/api/access')
COOKIE = 'riften_owner'
TTL = 4 * 60 * 60

def public_demo():
    return os.getenv('RIFTEN_PUBLIC_DEMO') == '1'

def owner_session(request: Request):
    secret = os.getenv('RIFTEN_OWNER_TOKEN', '')
    try:
        expires, signature = request.cookies.get(COOKIE, '').split('.', 1)
        if not secret or not int(time.time()) < int(expires) <= int(time.time()) + TTL:
            return False
        expected = hmac.new(secret.encode(), expires.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature, expected)
    except (ValueError, TypeError):
        return False

async def protect_demo(request: Request, call_next):
    if public_demo() and request.url.path.startswith('/api/'):
        if request.method not in ('GET', 'HEAD', 'OPTIONS') and request.url.path not in ('/api/access/login', '/api/access/logout') and not owner_session(request):
            return JSONResponse(status_code=403, content={'detail': 'Public demo is read only. Owner access is required for edits and paid model requests.'})
    response = await call_next(request)
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    return response

@router.get('')
def access(request: Request):
    return {'public_demo': public_demo(), 'editing_allowed': not public_demo() or owner_session(request)}

class Login(BaseModel):
    token: str = Field(min_length=1, max_length=512)

@router.post('/login')
def login(body: Login, response: Response):
    secret = os.getenv('RIFTEN_OWNER_TOKEN', '')
    if not public_demo() or not secret or not hmac.compare_digest(body.token.encode(), secret.encode()):
        raise HTTPException(401, 'Owner key was not accepted.')
    expires = str(int(time.time()) + TTL)
    signature = hmac.new(secret.encode(), expires.encode(), hashlib.sha256).hexdigest()
    response.set_cookie(COOKIE, expires + '.' + signature, max_age=TTL, httponly=True, secure=bool(os.getenv('VERCEL')), samesite='strict', path='/')
    return {'editing_allowed': True}

@router.post('/logout')
def logout(response: Response):
    response.delete_cookie(COOKIE, path='/', secure=bool(os.getenv('VERCEL')), httponly=True, samesite='strict')
    return {'editing_allowed': False}
