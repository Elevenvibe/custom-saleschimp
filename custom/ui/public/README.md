# UI Public Asset Overlay

Files dropped here are copied into `/app/public/` in the UI image at build time, **overwriting upstream defaults** of the same name.

## Common files to override

| File | Where the UI uses it |
|---|---|
| `favicon.ico` | browser tab |
| `axiom_icon.svg` | primary sidebar logo |
| `langfuse_icon.svg` | observability section |

To discover all current upstream public assets, inspect the running container:

```bash
docker run --rm --entrypoint sh ghcr.io/dograh-hq/dograh-ui:latest -c 'ls -la /app/public'
```

Match the filename and your version will win.
