"""Weekly leaderboard for the night-drive mini game."""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "game_scores",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("week", sa.String(9), nullable=False),
        sa.Column("car_id", sa.Integer, sa.ForeignKey("cars.id")),
        sa.Column("car_name", sa.String(125), nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("score", sa.Integer, nullable=False),
        sa.Column("level", sa.Integer, nullable=False),
        sa.Column("knockdowns", sa.Integer, nullable=False),
        sa.Column("drones", sa.Integer, nullable=False),
        sa.Column("bribes", sa.Integer, nullable=False),
        sa.Column("profit_kopecks", sa.Integer, nullable=False),
        sa.Column("duration_seconds", sa.Integer, nullable=False),
        sa.Column("reason", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.CheckConstraint("score >= 0"),
        sa.CheckConstraint("level >= 1"),
        sa.CheckConstraint("reason IN ('wrecked','broke','quit')"),
    )
    op.create_index("ix_game_week_score", "game_scores", ["week", "score"])
    op.create_index("ix_game_score", "game_scores", ["score"])
    op.create_index("uq_game_user_week", "game_scores", ["user_id", "week"], unique=True)


def downgrade():
    op.drop_index("uq_game_user_week", table_name="game_scores")
    op.drop_index("ix_game_score", table_name="game_scores")
    op.drop_index("ix_game_week_score", table_name="game_scores")
    op.drop_table("game_scores")
