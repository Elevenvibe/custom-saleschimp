"""tenant_sso_configs + sso_state

Revision ID: 0011_tenant_sso
Revises: 0010_multi_currency_fx
Create Date: 2026-05-26 16:00:00

Two tables for P2.B (Enterprise SSO):

1. tenant_sso_configs — one row per tenant that has SSO enabled.
   `idp_kind` discriminates between 'oidc' and 'saml'. Secrets
   (client_secret, signing cert / private key) are Fernet-encrypted
   via app.email.crypto, matching the convention used for cost
   provider keys and payment provider secrets in earlier migrations.

   `force_sso` decides whether the email/password login is hidden for
   that tenant's slug — default false so admins can opt in once they're
   confident their SSO config works.

   `attribute_map` is a JSONB dict — currently used for IdP-group →
   tenant-role mapping (per OQ-B2-3). Shape:
       { "<idp_group_name>": "<role>", "_default": "user" }

2. sso_state — short-lived CSRF + replay protection for the OIDC
   redirect dance. State row written when we start the redirect,
   verified + deleted when the IdP redirects back. TTL handled in
   the service layer (rows older than 10 minutes are treated as
   expired regardless of `expires_at`).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_tenant_sso"
down_revision: Union[str, None] = "0010_multi_currency_fx"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_sso_configs",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.BigInteger, nullable=False),
        sa.Column("idp_kind", sa.String(16), nullable=False),
        sa.Column("display_name", sa.String(128), nullable=False),
        # OIDC: discovery URL or issuer; SAML: entity ID. Public.
        sa.Column("issuer", sa.String(512), nullable=False),
        # OIDC: client_id; SAML: SP entity id. Public.
        sa.Column("client_id", sa.String(256), nullable=False),
        # Fernet-encrypted JSONB dict. OIDC: {"client_secret": "..."}.
        # SAML: {"private_key": "...", "signing_cert": "..."}.
        sa.Column("secrets_encrypted", postgresql.JSONB, nullable=True),
        # OIDC discovery URL OR SAML IdP metadata XML, depending on idp_kind.
        sa.Column("discovery_url", sa.String(512), nullable=True),
        sa.Column("metadata_xml", sa.Text, nullable=True),
        # When true, the email/password login is hidden for this tenant's
        # slug — they HAVE to come through the IdP.
        sa.Column("force_sso", sa.Boolean, nullable=False, server_default="false"),
        # JSONB role-mapping. Reserved key "_default" is the role to apply
        # when none of the IdP-group claims match.
        sa.Column(
            "attribute_map",
            postgresql.JSONB,
            nullable=False,
            server_default='{"_default":"user"}',
        ),
        sa.Column("active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "idp_kind IN ('oidc','saml')",
            name="ck_tenant_sso_configs_kind",
        ),
        # Only one config per tenant for now — keeps the slug → config
        # lookup a simple unique-index hit. Multi-IdP per tenant is a
        # later iteration.
        sa.UniqueConstraint("tenant_id", name="uq_tenant_sso_configs_tenant"),
    )

    op.create_table(
        "sso_state",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("state", sa.String(64), nullable=False, unique=True),
        sa.Column("tenant_id", sa.BigInteger, nullable=False),
        sa.Column("nonce", sa.String(64), nullable=False),
        sa.Column("redirect_uri", sa.String(512), nullable=False),
        # Optional return target so a deep-link bounce can pick up where
        # the user was before being kicked to the IdP.
        sa.Column("return_to", sa.String(512), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_sso_state_created", "sso_state", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_sso_state_created", table_name="sso_state")
    op.drop_table("sso_state")
    op.drop_table("tenant_sso_configs")
