"""Durable original document bytes for hosted deployments."""
from alembic import op
import sqlalchemy as sa
revision='004'
down_revision='003'

def upgrade():
    op.create_table('source_originals',sa.Column('version_id',sa.String(80),sa.ForeignKey('document_versions.id'),primary_key=True),sa.Column('filename',sa.String(300),nullable=False),sa.Column('data',sa.LargeBinary(),nullable=False),sa.Column('media_type',sa.String(160),nullable=False),sa.Column('content_hash',sa.String(64),nullable=False))

def downgrade():op.drop_table('source_originals')
