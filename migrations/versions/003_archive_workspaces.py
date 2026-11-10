"""Keep archived test workspaces out of normal navigation."""
from alembic import op
import sqlalchemy as sa
revision='003'
down_revision='002'

def upgrade():
    op.add_column('workspaces',sa.Column('archived',sa.Boolean(),nullable=False,server_default=sa.false()))

def downgrade():
    with op.batch_alter_table('workspaces') as batch:
        batch.drop_column('archived')
