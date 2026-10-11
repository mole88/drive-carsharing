"""add car image

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cars",
        sa.Column("image", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cars", "image")
