# HTTP Bearer Authentication Design

## Goal

Protect the Streamable HTTP MCP endpoint with a static bearer token configured through the environment, while leaving the stdio transport unchanged.

## Configuration

- Add `MCP_HTTP_BEARER_TOKEN` as an optional environment input at schema level.
- When `MCP_TRANSPORT=http`, startup fails with a configuration error unless the token is present and non-empty.
- When `MCP_TRANSPORT=stdio`, the token is ignored and remains optional.
- The token must never be logged, serialized into errors, or included in startup output.

## Request Flow

For requests to the configured MCP HTTP path:

1. Confirm the request targets the configured path.
2. Validate the HTTP `Host` header using the existing allowlist behavior.
3. Require an `Authorization` header using the `Bearer <token>` scheme.
4. Compare the supplied credential with the configured token using a timing-safe comparison.
5. Forward authenticated requests to the MCP Streamable HTTP handler.

Requests to other paths continue to receive `404 Not Found`.

## Failure Behavior

- Missing, malformed, or incorrect credentials receive `401 Unauthorized`.
- The response includes `WWW-Authenticate: Bearer` and a generic JSON error body.
- Authentication failures do not invoke MCP handlers or database operations.
- A missing HTTP token produces a helpful startup configuration error naming only the environment variable.

## Client Configuration

Clients send the token as a standard bearer credential. Codex can configure the endpoint with `--bearer-token-env-var MCP_HTTP_BEARER_TOKEN`, keeping the secret out of its MCP configuration file.

## Testing

- Configuration accepts stdio without a token.
- Configuration rejects HTTP without a token.
- Configuration accepts HTTP with a non-empty token.
- HTTP requests with no token, a malformed scheme, or a wrong token receive `401`.
- A correct bearer token reaches the MCP handler.
- Existing host validation and route handling continue to work.

## Operational Notes

This is shared-secret authentication suitable for internal deployments. It does not replace TLS when traffic crosses an untrusted network, and it does not provide per-user authorization, token rotation, expiry, or audit identity. Those controls can be added later at the HTTP boundary or through a reverse proxy.
