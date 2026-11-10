from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import String, Text, ForeignKey, Integer, JSON, Boolean, UniqueConstraint, CheckConstraint, Index, text, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

def uid(): return uuid4().hex
def now(): return datetime.now(timezone.utc).isoformat()

class Id:
    id: Mapped[str] = mapped_column(String(80), primary_key=True, default=uid)
    created_at: Mapped[str] = mapped_column(String(50), default=now)

class Workspace(Id, Base):
    __tablename__ = 'workspaces'
    name: Mapped[str] = mapped_column(String(160))
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default='0')

class Authority(Id, Base):
    __tablename__ = 'authorities'
    name: Mapped[str] = mapped_column(String(160), unique=True)
    jurisdiction: Mapped[str] = mapped_column(String(80), default='India')

class Document(Id, Base):
    __tablename__ = 'source_documents'
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)
    authority_id: Mapped[str | None] = mapped_column(ForeignKey('authorities.id'))
    title: Mapped[str] = mapped_column(String(300))
    url: Mapped[str | None] = mapped_column(Text)
    jurisdiction: Mapped[str] = mapped_column(String(80), default='India')
    kind: Mapped[str] = mapped_column(String(30), default='regulation')

class Version(Id, Base):
    __tablename__ = 'document_versions'
    document_id: Mapped[str] = mapped_column(ForeignKey('source_documents.id'), index=True)
    label: Mapped[str] = mapped_column(String(160))
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    text: Mapped[str] = mapped_column(Text, default='')
    original_path: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default='ready')
    error: Mapped[str | None] = mapped_column(Text)
    provenance: Mapped[str] = mapped_column(Text, default='User upload. Legal status unverified.')
    effective_date: Mapped[str | None] = mapped_column(String(10))
    legal_status: Mapped[str] = mapped_column(String(40), default='unverified')
    __table_args__ = (UniqueConstraint('document_id', 'content_hash'),)

class Section(Id, Base):
    __tablename__ = 'document_sections'
    version_id: Mapped[str] = mapped_column(ForeignKey('document_versions.id'), index=True)
    reference: Mapped[str] = mapped_column(String(160))
    ordinal: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    page: Mapped[int | None] = mapped_column(Integer)
    embedding: Mapped[list | None] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint('version_id', 'ordinal'),)

class SourceOriginal(Base):
    __tablename__='source_originals'
    version_id:Mapped[str]=mapped_column(ForeignKey('document_versions.id'),primary_key=True)
    filename:Mapped[str]=mapped_column(String(300))
    data:Mapped[bytes]=mapped_column(LargeBinary)
    media_type:Mapped[str]=mapped_column(String(160))
    content_hash:Mapped[str]=mapped_column(String(64))

class Assessment(Id, Base):
    __tablename__ = 'impact_assessments'
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)
    old_version_id: Mapped[str] = mapped_column(ForeignKey('document_versions.id'))
    new_version_id: Mapped[str] = mapped_column(ForeignKey('document_versions.id'))
    title: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(40), default='compared')
    error: Mapped[str | None] = mapped_column(Text)
    pipeline: Mapped[list] = mapped_column(JSON, default=list)

class Change(Id, Base):
    __tablename__ = 'regulatory_changes'
    assessment_id: Mapped[str] = mapped_column(ForeignKey('impact_assessments.id'), index=True)
    old_section_id: Mapped[str | None] = mapped_column(ForeignKey('document_sections.id'))
    new_section_id: Mapped[str | None] = mapped_column(ForeignKey('document_sections.id'))
    classification: Mapped[str] = mapped_column(String(50))
    explanation: Mapped[str | None] = mapped_column(Text)
    business_area: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(40), default='unreviewed')
    analysis_status: Mapped[str] = mapped_column(String(40), default='pending')
    unresolved: Mapped[list] = mapped_column(JSON, default=list)
    match_method: Mapped[str] = mapped_column(String(40), default='section')
    inference_id: Mapped[str | None] = mapped_column(ForeignKey('inference_runs.id'))

class Evidence(Id, Base):
    __tablename__ = 'assessment_evidence'
    change_id: Mapped[str] = mapped_column(ForeignKey('regulatory_changes.id'), index=True)
    section_id: Mapped[str] = mapped_column(ForeignKey('document_sections.id'))
    quote: Mapped[str] = mapped_column(Text)
    origin: Mapped[str] = mapped_column(String(30), default='source')

class Requirement(Id, Base):
    __tablename__ = 'requirements'
    change_id: Mapped[str] = mapped_column(ForeignKey('regulatory_changes.id'), unique=True)
    text: Mapped[str] = mapped_column(Text)
    rule: Mapped[dict | None] = mapped_column(JSON)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verification_note: Mapped[str | None] = mapped_column(Text)

class Entity(Id, Base):
    """Typed internal policies, processes, controls, and operational records."""
    __tablename__ = 'organization_entities'
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    name: Mapped[str] = mapped_column(String(300))
    external_id: Mapped[str | None] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default='')
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (CheckConstraint("kind IN ('policy','process','control','record')"), UniqueConstraint('workspace_id', 'kind', 'external_id'))

class Node(Id, Base):
    __tablename__ = 'graph_nodes'
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)
    kind: Mapped[str] = mapped_column(String(30))
    label: Mapped[str] = mapped_column(String(300))
    entity_id: Mapped[str | None] = mapped_column(ForeignKey('organization_entities.id'), unique=True)
    change_id: Mapped[str | None] = mapped_column(ForeignKey('regulatory_changes.id'), unique=True)
    document_id: Mapped[str | None] = mapped_column(ForeignKey('source_documents.id'), unique=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey('review_tasks.id'), unique=True)

class Dependency(Id, Base):
    __tablename__ = 'dependency_relationships'
    source_id: Mapped[str] = mapped_column(ForeignKey('graph_nodes.id'), index=True)
    target_id: Mapped[str] = mapped_column(ForeignKey('graph_nodes.id'), index=True)
    rationale: Mapped[str] = mapped_column(Text)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint('source_id', 'target_id'), CheckConstraint('source_id != target_id'))

class Replay(Id, Base):
    __tablename__ = 'replay_runs'
    assessment_id: Mapped[str] = mapped_column(ForeignKey('impact_assessments.id'), index=True)
    requirement_id: Mapped[str] = mapped_column(ForeignKey('requirements.id'))
    rule_snapshot: Mapped[dict] = mapped_column(JSON)

class ReplayResult(Id, Base):
    __tablename__ = 'replay_results'
    replay_id: Mapped[str] = mapped_column(ForeignKey('replay_runs.id'), index=True)
    entity_id: Mapped[str] = mapped_column(ForeignKey('organization_entities.id'))
    old_result: Mapped[str] = mapped_column(String(40))
    new_result: Mapped[str] = mapped_column(String(40))
    outcome: Mapped[str] = mapped_column(String(40), index=True)
    explanation: Mapped[str] = mapped_column(Text)
    record_snapshot: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint('replay_id', 'entity_id'),)

class Task(Id, Base):
    __tablename__ = 'review_tasks'
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)
    title: Mapped[str] = mapped_column(String(300))
    change_id: Mapped[str | None] = mapped_column(ForeignKey('regulatory_changes.id'))
    entity_id: Mapped[str | None] = mapped_column(ForeignKey('organization_entities.id'))
    assignee: Mapped[str] = mapped_column(String(160), default='Local reviewer')
    priority: Mapped[str] = mapped_column(String(20), default='medium')
    status: Mapped[str] = mapped_column(String(30), default='open', index=True)
    due_date: Mapped[str | None] = mapped_column(String(10))
    evidence: Mapped[str] = mapped_column(Text, default='')

class Comment(Id, Base):
    __tablename__ = 'review_comments'
    task_id: Mapped[str] = mapped_column(ForeignKey('review_tasks.id'), index=True)
    text: Mapped[str] = mapped_column(Text)
    author: Mapped[str] = mapped_column(String(80), default='Local reviewer')

class Activity(Id, Base):
    __tablename__ = 'activity_history'
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)
    action: Mapped[str] = mapped_column(Text)
    object_id: Mapped[str | None] = mapped_column(String(80), index=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    actor: Mapped[str] = mapped_column(String(80), default='Local reviewer')

class Fetch(Id, Base):
    __tablename__ = 'source_fetch_history'
    document_id: Mapped[str] = mapped_column(ForeignKey('source_documents.id'), index=True)
    status: Mapped[str] = mapped_column(String(30))
    content_hash: Mapped[str | None] = mapped_column(String(64))
    error: Mapped[str | None] = mapped_column(Text)

class ModelJob(Id, Base):
    __tablename__ = 'model_alignment_jobs'
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)
    remote_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    kind: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(40))
    model_id: Mapped[str | None] = mapped_column(String(160))
    request: Mapped[dict] = mapped_column(JSON, default=dict)
    response: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        Index('uq_workspace_alignment', 'workspace_id', unique=True, sqlite_where=text("kind = 'alignment'"), postgresql_where=text("kind = 'alignment'")),
        Index('uq_workspace_benchmark', 'workspace_id', unique=True, sqlite_where=text("kind = 'benchmark'"), postgresql_where=text("kind = 'benchmark'")),
    )

class Deployment(Id, Base):
    __tablename__ = 'model_deployments'
    job_id: Mapped[str] = mapped_column(ForeignKey('model_alignment_jobs.id'), unique=True)
    model_id: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(40))
    response: Mapped[dict] = mapped_column(JSON, default=dict)

class Inference(Id, Base):
    __tablename__ = 'inference_runs'
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)
    model_id: Mapped[str] = mapped_column(String(160))
    purpose: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(40))
    request: Mapped[dict] = mapped_column(JSON)
    response: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)

class Evaluation(Id, Base):
    __tablename__ = 'evaluation_results'
    workspace_id: Mapped[str] = mapped_column(ForeignKey('workspaces.id'), index=True)
    remote_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    status: Mapped[str] = mapped_column(String(40))
    request: Mapped[dict] = mapped_column(JSON)
    response: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint('workspace_id', name='uq_workspace_evaluation'),)
