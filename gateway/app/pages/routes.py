"""Gateway-served HTML for customer signup + verify result.

Lives at the gateway (not in admin-ui or Dograh UI) so customers don't need
to reach a different domain before they have an account. Replace with a
proper Next.js customer app at app.mysaleschimp.com in P1.D — these
templates intentionally stay minimal.
"""

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from jinja2 import Environment, FileSystemLoader, select_autoescape

router = APIRouter(include_in_schema=False)

_TEMPLATES = Path(__file__).parent / "templates"
_jinja = Environment(
    loader=FileSystemLoader(_TEMPLATES),
    autoescape=select_autoescape(["html", "xml"]),
    enable_async=True,
)


@router.get("/signup", response_class=HTMLResponse)
async def signup_page(_request: Request) -> HTMLResponse:
    tmpl = _jinja.get_template("signup.html")
    return HTMLResponse(await tmpl.render_async())


@router.get("/verify", response_class=HTMLResponse)
async def verify_page(_request: Request, token: str | None = None) -> HTMLResponse:
    tmpl = _jinja.get_template("verify.html")
    return HTMLResponse(await tmpl.render_async(token=token or ""))


@router.get("/accept-invite", response_class=HTMLResponse)
async def accept_invite_page(_request: Request, token: str | None = None) -> HTMLResponse:
    tmpl = _jinja.get_template("accept-invite.html")
    return HTMLResponse(await tmpl.render_async(token=token or ""))
