"""mail folder column

Revision ID: 0017_mail_folder
Revises: 0016_mail_messages
Create Date: 2026-05-28 18:00:00

mail_messages.folder lets the Email page filter the list pane by
folder (Inbox / Sent / Spam / Updates). Server-side rather than UI-
side derivation because the fetcher will eventually pull from multiple
IMAP folders/labels (today it only pulls INBOX), and we want stored
rows to carry their source folder forward.

Defaults:
  inbound  → 'INBOX'   (fetcher's only source for now)
  outbound → 'SENT'    (send_one stamps this)

Future folders (SPAM, UPDATES) require pulling those IMAP folders in
the fetcher — separate slice. The column gracefully handles them
with no further migration.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017_mail_folder"
down_revision: Union[str, None] = "0016_mail_messages"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("mail_messages") as batch:
        batch.add_column(
            sa.Column(
                "folder",
                sa.String(64),
                nullable=False,
                server_default="INBOX",
            )
        )
    # Backfill existing outbound rows to SENT.
    op.execute(
        "UPDATE mail_messages SET folder='SENT' WHERE direction='outbound'"
    )
    op.create_index(
        "ix_mail_messages_scope_folder",
        "mail_messages",
        ["scope_kind", "scope_id", "folder"],
    )


def downgrade() -> None:
    op.drop_index("ix_mail_messages_scope_folder", table_name="mail_messages")
    with op.batch_alter_table("mail_messages") as batch:
        batch.drop_column("folder")
