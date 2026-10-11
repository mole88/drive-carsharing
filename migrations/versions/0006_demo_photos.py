"""Backfill missing photographs on existing demo cars.

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cars = sa.table(
        "cars",
        sa.column("brand", sa.String),
        sa.column("model", sa.String),
        sa.column("plate", sa.String),
        sa.column("image", sa.String),
    )
    for brand, model, plate, image in (
        ("Kia", "Rio", "А101АА178", "images/kiario.png"),
        ("Hyundai", "Solaris", "А102АА178", "images/hsolaris.png"),
        ("Skoda", "Octavia", "А103АА178", "images/skodaoctavia.png"),
        ("BMW", "320i", "А104АА178", "images/BMW-3.png"),
    ):
        op.execute(
            cars.update()
            .where(
                cars.c.brand == brand,
                cars.c.model == model,
                cars.c.plate == plate,
                sa.or_(cars.c.image.is_(None), cars.c.image == ""),
            )
            .values(image=image)
        )


def downgrade() -> None:
    # Keep the photographs: user edits cannot be distinguished from this backfill.
    pass
