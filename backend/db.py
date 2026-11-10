import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')
DATA_ROOT=Path(os.getenv('RIFTEN_DATA_DIR', '/tmp/riften' if os.getenv('VERCEL') else str(ROOT/'data')))
(DATA_ROOT / 'originals').mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///./data/riften.db')
database_url=make_url(DATABASE_URL)
if database_url.drivername in ('postgres','postgresql'):
    database_url=database_url.set(drivername='postgresql+psycopg')
    DATABASE_URL=database_url.render_as_string(hide_password=False)
if database_url.drivername.startswith('sqlite') and database_url.database and database_url.database!=':memory:':
    database_path=Path(database_url.database)
    if not database_path.is_absolute():database_path=(ROOT/database_path).resolve()
    database_url=database_url.set(database=str(database_path))
    DATABASE_URL=database_url.render_as_string(hide_password=False)
engine = create_engine(DATABASE_URL, connect_args={'check_same_thread': False} if DATABASE_URL.startswith('sqlite') else {}, pool_pre_ping=True)
if DATABASE_URL.startswith('sqlite'):
    @event.listens_for(engine, 'connect')
    def sqlite_fk(conn, _):
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA journal_mode=WAL')

Session = sessionmaker(engine, expire_on_commit=False)
class Base(DeclarativeBase):
    pass

def session():
    with Session() as db:
        yield db
