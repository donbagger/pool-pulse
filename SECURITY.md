# Security

Please report a vulnerability privately through
[GitHub's private reporting](https://github.com/donbagger/pool-pulse/security/advisories/new)
rather than in a public issue. I aim to answer within a few days.

## What pool-pulse does with your key

- It reads `DEXPAPRIKA_API_KEY` from the environment and sends it only in the
  `Authorization` header, only to `https://api.dexpaprika.com` or
  `https://api-pro.dexpaprika.com`. Any other `DEXPAPRIKA_BASE_URL` is refused before a
  request is made, and redirects are not followed.
- It never prints, logs or stores the key. `.env` is in `.gitignore`.

## Untrusted data

Token symbols and names come from on-chain metadata that anyone can set. pool-pulse strips
control characters and bidirectional overrides from every string it gets from the API, in
the table and in the JSON, so a token cannot write escape sequences to your terminal.

## Supply chain

There are no runtime or development dependencies. CI actions are pinned to commit SHAs,
Dependabot keeps those pins current, and the workflow token is read-only.

For problems in the DexPaprika API itself, see https://docs.dexpaprika.com.
