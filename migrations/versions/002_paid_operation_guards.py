"""Database guards for concurrent paid-operation submissions."""
from alembic import op
import sqlalchemy as sa
revision='002'
down_revision='001'

def upgrade():
    op.create_index('uq_workspace_alignment','model_alignment_jobs',['workspace_id'],unique=True,sqlite_where=sa.text("kind = 'alignment'"),postgresql_where=sa.text("kind = 'alignment'"))
    op.create_index('uq_workspace_benchmark','model_alignment_jobs',['workspace_id'],unique=True,sqlite_where=sa.text("kind = 'benchmark'"),postgresql_where=sa.text("kind = 'benchmark'"))
    with op.batch_alter_table('evaluation_results') as batch:
        batch.alter_column('remote_id',existing_type=sa.String(100),nullable=True)
        batch.create_unique_constraint('uq_workspace_evaluation',['workspace_id'])

def downgrade():
    with op.batch_alter_table('evaluation_results') as batch:
        batch.drop_constraint('uq_workspace_evaluation',type_='unique')
        batch.alter_column('remote_id',existing_type=sa.String(100),nullable=False)
    op.drop_index('uq_workspace_benchmark',table_name='model_alignment_jobs')
    op.drop_index('uq_workspace_alignment',table_name='model_alignment_jobs')
