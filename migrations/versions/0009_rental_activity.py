"""Track activity so abandoned trips release their cars automatically."""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("rentals", sa.Column("last_activity_at", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("rentals", "last_activity_at")
