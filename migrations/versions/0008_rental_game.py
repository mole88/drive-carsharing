"""Attach game outcomes and weekly records to rental history."""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("rentals", sa.Column("game_result", sa.JSON(), nullable=True))
    with op.batch_alter_table(
        "game_scores",
        table_args=(
            sa.CheckConstraint("score >= 0", name="ck_game_score_nonnegative"),
            sa.CheckConstraint("level >= 1", name="ck_game_level_positive"),
            sa.CheckConstraint("reason IN ('wrecked','broke','quit')", name="ck_game_reason"),
        )
        if op.get_bind().dialect.name == "sqlite"
        else (),
    ) as batch:
        batch.add_column(sa.Column("rental_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_game_score_rental", "rentals", ["rental_id"], ["id"])


def downgrade():
    with op.batch_alter_table("game_scores") as batch:
        batch.drop_constraint("fk_game_score_rental", type_="foreignkey")
        batch.drop_column("rental_id")
    op.drop_column("rentals", "game_result")
